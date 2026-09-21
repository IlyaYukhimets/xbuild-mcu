-- Image audit: what actually ended up in the firmware.
--
-- Every check here needs nothing but the built ELF and the toolchain, so the task is
-- project-independent: no thresholds, no expected-symbol lists, no config edits. Rules
-- that DO need project expectations (flash/RAM budgets, which drivers must be absent,
-- which interrupt vectors must be strong) are deliberately out of scope — they belong in
-- a config file that only tightens the verdict of what is found here.
--
-- The point: these are the findings that cost this codebase real time and bytes, and all
-- of them are visible in `nm`/`size`/`objdump` output once you know what to look for.
--
--     xmake audit
--     xmake audit --elf=build/example.elf
--
-- Exits non-zero when any check reports FAIL.

task("audit")
    set_menu {
        usage = "xmake audit [options]",
        description = "Audit the built image: exit machinery, guards, pre-main init, heap, size",
        options = {
            {nil, "elf", "kv", nil, "audit a specific ELF (default: the built target)"},
            {nil, "target", "kv", nil, "target whose artifact to audit (default: the only built target)"},
        }
    }
    on_run(function (target)
        import("core.base.option")
        import("core.base.json")
        import("core.project.project")

        -- A repository may build several firmware targets (one per board). Resolve the
        -- one to audit: an explicit --target wins, then a legacy "firmware" target,
        -- then the only target there is. With several targets and no --target the
        -- choice would be arbitrary, so it is reported instead of guessed.
        local function resolve_target_name()
            local name = option.get("target")
            if name then
                return name
            end
            if project.target("firmware") then
                return "firmware"
            end

            local names = {}
            for tname, _ in pairs(project.targets() or {}) do
                table.insert(names, tname)
            end
            table.sort(names)

            if #names == 1 then
                return names[1]
            end
            if #names == 0 then
                raise("no targets in the project")
            end
            raise("several targets; pass --target=<name>, one of: " .. table.concat(names, ", "))
        end

        -- ==================== helpers ====================

        -- Capture a command's output; a failing command is not fatal for the audit.
        local function capture(program, args)
            local out, err, ok = nil, nil, true
            try {
                function ()
                    out, err = os.iorunv(program, args)
                end,
                catch {
                    function (e)
                        ok  = false
                        err = tostring((type(e) == "table" and (e.errors or e.stderr)) or e)
                    end
                }
            }
            return ok, out or "", err or ""
        end

        -- Resolve a binutils tool from the target's own toolchain rather than from PATH:
        -- a build that picked its compiler from PATH once already produced artifacts with
        -- the wrong GCC, so the audit must read the image with the same toolchain the
        -- build used. Candidates are tried in order of authority; PATH comes last.
        local tool_cache = {}
        local function tool_path(name)
            if tool_cache[name] then
                return tool_cache[name]
            end

            local found = nil
            local function use(candidate)
                if not found and candidate and candidate ~= "" and os.isfile(candidate) then
                    found = candidate
                end
            end

            local t = project.target(resolve_target_name())
            if t then
                -- 1. the configured toolchain's bin directory
                local bindir = nil
                try {
                    function () bindir = t:toolchain():bindir() end,
                    catch { function () bindir = nil end }
                }
                if bindir then
                    use(path.join(bindir, "arm-none-eabi-" .. name))
                end

                -- 2. the toolchain root the project declares to xmake (arm_gcc_path)
                if not found then
                    local sdkdir = nil
                    try {
                        function () sdkdir = json.decode(io.readfile(".lua/config.json")).arm_gcc_path end,
                        catch { function () sdkdir = nil end }
                    }
                    if sdkdir and sdkdir ~= "" then
                        use(path.join(sdkdir, "bin", "arm-none-eabi-" .. name))
                    end
                end

                -- 3. next to the compiler the build actually used (asked last: xmake
                --    warns while the toolchain has not been checked yet)
                if not found then
                    local cc = nil
                    try {
                        function () cc = t:tool("cc") end,
                        catch { function () cc = nil end }
                    }
                    if cc and cc ~= "" then
                        use(path.join(path.directory(cc), path.basename(cc):gsub("gcc$", "") .. name))
                    end
                end
            end

            -- 4. PATH, as the last resort
            if not found then
                use("arm-none-eabi-" .. name)
            end

            tool_cache[name] = found or ("arm-none-eabi-" .. name)
            return tool_cache[name]
        end

        local function find_elf()
            local wanted = option.get("elf")
            if wanted then
                if not os.isfile(wanted) then
                    raise("ELF not found: " .. wanted)
                end
                return wanted
            end

            local t = project.target(resolve_target_name())
            if t then
                local file = t:targetfile()
                if file and os.isfile(file) then
                    return file
                end
            end

            local mode = get_config("mode") or "debug"
            local name = nil
            try {
                function () name = project.target(resolve_target_name()):data("project_name") end,
                catch { function () name = nil end }
            }
            local candidates = {}
            if name then
                table.insert(candidates, path.join("build/cross/arm", mode, name .. ".elf"))
                table.insert(candidates, path.join("build", name .. ".elf"))
            end
            for _, candidate in ipairs(candidates) do
                if os.isfile(candidate) then
                    return candidate
                end
            end

            raise("no ELF found - build the project first, or pass --elf=<path>")
        end

        -- ==================== read the image ====================

        local elf  = find_elf()
        local nm   = tool_path("nm")
        local objd = tool_path("objdump")

        local ok, symbols = capture(nm, {"-S", "--size-sort", elf})
        if not ok then
            raise("cannot read symbols: " .. symbols)
        end

        -- `nm -S --size-sort` omits symbols that have no size (linker markers,
        -- frame_dummy, ...), so the full symbol table comes from a plain `nm` and the
        -- sizes are overlaid from the sorted one. Using only the sorted output makes
        -- those symbols invisible, which turns a benign .init_array into a false alarm.
        local ok_all, all_symbols = capture(nm, {elf})
        if not ok_all then
            raise("cannot read the symbol table: " .. all_symbols)
        end

        -- name -> {size, type, address}; and address -> name, to resolve pointers
        local syms, by_addr = {}, {}
        local function remember(name, entry)
            syms[name] = entry
            by_addr[entry.address & 0xFFFFFFFE] = name -- mask the Thumb bit
        end

        for line in all_symbols:gmatch("[^\n]+") do
            local addr, size, kind, name = line:match("^(%x+)%s+(%x+)%s+(%S)%s+(.+)$")
            if not name then
                addr, kind, name = line:match("^(%x+)%s+(%S)%s+(.+)$")
                size = "0"
            end
            if name then
                remember(name, { address = tonumber(addr, 16), size = tonumber(size, 16) or 0, kind = kind })
            end
        end
        for line in symbols:gmatch("[^\n]+") do
            local addr, size, kind, name = line:match("^(%x+)%s+(%x+)%s+(%S)%s+(.+)$")
            if name then
                remember(name, { address = tonumber(addr, 16), size = tonumber(size, 16) or 0, kind = kind })
            end
        end

        -- Sections: "RAM" must mean the sections that are actually writable on this
        -- target, not a guessed address range (a const table in .rodata is not RAM).
        local ram_ranges = {}
        local ok_headers, headers = capture(objd, {"-h", elf})
        if ok_headers then
            local current = nil
            for line in headers:gmatch("[^\n]+") do
                local idx, name, size, vma, lma = line:match("^%s*(%d+)%s+(%S+)%s+(%x+)%s+(%x+)%s+(%x+)")
                if idx then
                    current = { name = name, first = tonumber(vma, 16) or 0,
                                lma = tonumber(lma, 16) or 0, size = tonumber(size, 16) or 0 }
                elseif current then
                    -- The flags sit on the continuation line. A writable section is
                    -- ALLOC without READONLY; a section that has contents but LMA == VMA
                    -- lives in flash (array tables), so it is not RAM.
                    local alloc = line:find("ALLOC", 1, true) ~= nil
                    local readonly = line:find("READONLY", 1, true) ~= nil
                    local contents = line:find("CONTENTS", 1, true) ~= nil
                    if alloc and not readonly and current.size > 0
                        and (not contents or current.lma ~= current.first) then
                        table.insert(ram_ranges, { name = current.name, first = current.first,
                                                   last = current.first + current.size - 1 })
                    end
                    current = nil
                end
            end
        end

        local function ram_section(address)
            for _, range in ipairs(ram_ranges) do
                if address >= range.first and address <= range.last then
                    return range.name
                end
            end
            return nil
        end

        local function find_by_prefix(patterns)
            local found = {}
            for name, entry in pairs(syms) do
                for _, pattern in ipairs(patterns) do
                    if name:find(pattern, 1, true) then
                        table.insert(found, { name = name, size = entry.size })
                        break
                    end
                end
            end
            table.sort(found, function (a, b) return a.name < b.name end)
            return found
        end

        -- ==================== checks ====================

        local report = {}
        local function add(severity, rule, message, details)
            table.insert(report, { severity = severity, rule = rule, message = message, details = details })
        end

        -- 1. Exit machinery: a static-storage object with a non-trivial destructor
        --    registers itself with the C runtime, pulling all of newlib's exit code.
        local exit_syms = find_by_prefix({"__cxa_atexit", "__aeabi_atexit", "__register_exitproc"})
        if #exit_syms > 0 then
            local names = {}
            for _, s in ipairs(exit_syms) do table.insert(names, s.name) end
            add("FAIL", "exit-machinery",
                "exit registration present: a static-storage object has a non-trivial destructor",
                {"symbols: " .. table.concat(names, ", "),
                 "cost on Cortex-M: ~200 B flash + ~400 B RAM of newlib exit code",
                 "fix: make the type trivially destructible, or hold it in NoDestructor"})
        end

        -- 2. Guard variables: a function-local static with dynamic initialization checks
        --    a guard byte on every access and calls __cxa_guard_acquire once.
        local guard_syms = find_by_prefix({"_ZGV", "__cxa_guard_acquire", "__cxa_guard_release"})
        if #guard_syms > 0 then
            local names = {}
            for i, s in ipairs(guard_syms) do
                if i > 8 then table.insert(names, "...") break end
                table.insert(names, s.name)
            end
            add("FAIL", "guards",
                string.format("%d guard symbol(s): function-local statics are initialised at runtime",
                              #guard_syms),
                {"symbols: " .. table.concat(names, ", "),
                 "every access pays a guard-byte load plus a branch",
                 "fix: namespace-scope constinit storage (mcu::Instance)"})
        end

        -- 3. Pre-main code: _GLOBAL__sub_I_* functions, and the authoritative fact - the
        --    contents of .init_array. Anything but the toolchain's frame_dummy means the
        --    firmware runs code before main(), with an unspecified order across TUs.
        local premain = find_by_prefix({"_GLOBAL__sub_I", "__static_initialization"})
        local init_names = {}
        local ok_init, init_dump = capture(objd, {"-s", "-j", ".init_array", elf})
        if ok_init and init_dump:find("Contents of section .init_array", 1, true) then
            local body = init_dump:match("Contents of section %.init_array:(.*)") or ""
            for line in body:gmatch("[^\n]+") do
                -- objdump -s prints: <address> <hex words...>  <ascii>"; the hex columns are
                -- separated from the text rendering by two spaces, which is the boundary.
                local rest = line:match("^%s*%x+%s+(.*)$")
                local hexarea = rest and (rest:match("^([0-9a-f ]-)%s%s") or rest) or ""
                for word in hexarea:gmatch("(%x%x%x%x%x%x%x%x)") do
                    -- objdump prints the bytes as stored, so each 4-byte group is
                    -- little-endian on this target: swap it to get the pointer value.
                    local b1, b2, b3, b4 = word:sub(1, 2), word:sub(3, 4), word:sub(5, 6), word:sub(7, 8)
                    local value = tonumber(b4 .. b3 .. b2 .. b1, 16)
                    table.insert(init_names, by_addr[value & 0xFFFFFFFE] or string.format("0x%08x", value))
                end
            end
        end
        local foreign_init = {}
        for _, name in ipairs(init_names) do
            if not name:find("frame_dummy", 1, true) then
                table.insert(foreign_init, name)
            end
        end
        if #premain > 0 or #foreign_init > 0 then
            add("FAIL", "pre-main",
                "code runs before main(): dynamic initialization of a namespace-scope object",
                {"generators: " .. (#premain > 0 and tostring(#premain) .. " _GLOBAL__sub_I_*" or "none"),
                 ".init_array: " .. (#init_names > 0 and table.concat(init_names, ", ") or "empty"),
                 "cost: flash spent on work the linker already knows, plus unspecified",
                 "      order across translation units (hardware touched before clock setup)"})
        end

        -- 4. Heap: malloc and friends are only reachable if something allocates. The
        --    callers are what make this actionable, so find them in the disassembly.
        local heap_patterns = {"malloc", "_malloc_r", "_free_r", "_sbrk", "sbrk_aligned",
                               "__malloc_lock", "__malloc_unlock", "_Znwj", "_ZdlP"}
        local heap_syms = find_by_prefix(heap_patterns)
        if #heap_syms > 0 then
            local callers = {}
            local ok_dis, dis = capture(objd, {"-d", "-C", elf})
            if ok_dis and #dis > 0 then
                local current = nil
                for line in dis:gmatch("[^\n]+") do
                    local func = line:match("^%x+ <(.+)>:$")
                    if func then
                        current = func
                    elseif current and (line:find("\tbl\t") or line:find("\tb\t") or line:find("\tcall\t")) then
                        for _, pattern in ipairs(heap_patterns) do
                            if line:find(pattern, 1, true) and (line:find("<") or line:find(pattern .. "@")) then
                                if not callers[current] then
                                    callers[current] = true
                                end
                                break
                            end
                        end
                    end
                end
            end

            local details = {string.format("%d heap symbol(s)", #heap_syms)}
            local caller_names = {}
            for name in pairs(callers) do table.insert(caller_names, name) end
            table.sort(caller_names)
            for i, name in ipairs(caller_names) do
                if i > 8 then table.insert(details, "  ... and more") break end
                table.insert(details, "  called from: " .. name)
            end
            if #caller_names == 0 then
                table.insert(details, "  no caller found: symbols are linked but unreachable")
            end
            table.insert(details, "note: legitimate for some projects - that is why this is WARN, not FAIL")
            add("WARN", "heap", "dynamic memory in the image", details)
        end

        -- 5. 64-bit division: on Cortex-M4 with a hardware udiv, pulling the library
        --    helper usually means an accidental 64-bit expression.
        local div_syms = find_by_prefix({"__udivmoddi4", "__aeabi_uldivmod", "__aeabi_ldivmod"})
        if #div_syms > 0 then
            local names = {}
            for _, s in ipairs(div_syms) do
                table.insert(names, string.format("%s (%d B)", s.name, s.size))
            end
            add("WARN", "div64", "64-bit division helper in the image",
                {"symbols: " .. table.concat(names, ", "), "check for an accidental 64-bit expression"})
        end

        -- 6. Virtual dispatch: the concept layer exists so drivers carry no vtable.
        local vtable_syms = find_by_prefix({"_ZTV", "vtable for", "_ZTI", "typeinfo for"})
        if #vtable_syms > 0 then
            local names = {}
            for i, s in ipairs(vtable_syms) do
                if i > 6 then table.insert(names, "...") break end
                table.insert(names, s.name)
            end
            add("WARN", "vtable", string.format("%d vtable/typeinfo symbol(s)", #vtable_syms),
                {"symbols: " .. table.concat(names, ", ")})
        end

        -- 7. Memory: everything below is read straight from the ELF, so nothing has to
        --    be told to the task. All four are address-valued symbols (_Min_* are absolute),
        --    so the value comes from the symbol's address, not its size.
        local function sym_value(name)
            local s = syms[name]
            return s and s.address or nil
        end
        local estack = sym_value("_estack")
        local minstack = sym_value("_Min_Stack_Size")
        local heap_reserve = sym_value("_Min_Heap_Size")
        local end_sym = sym_value("_end")
        if estack and minstack and end_sym then
            local free = estack - minstack - end_sym
            add("INFO", "memory", string.format("free RAM below the reserved stack: %d B", free),
                {string.format("_estack 0x%08X - _Min_Stack_Size 0x%X - _end 0x%08X",
                               estack, minstack, end_sym),
                 "the reserved stack size is a budget, not the measured high-water mark"})
        end
        if heap_reserve and heap_reserve > 0 and #heap_syms == 0 then
            add("WARN", "memory",
                string.format("_Min_Heap_Size reserves %d B but nothing uses the heap", heap_reserve),
                {"remove the reservation or the firmware pays RAM for an unused heap"})
        end

        -- 8. What actually occupies RAM (writable sections only).
        -- CRT and linker-script markers are skipped: the ELF gives them spans that cover
        -- real objects (`completed.1` spans most of .bss, `_end` covers the reserved stack
        -- region), so they would dominate the list. They are toolchain internals, in the
        -- same category as frame_dummy.
        local markers = {
            ["_end"] = true, ["__end__"] = true, ["_edata"] = true, ["__data_start"] = true,
            ["__bss_end__"] = true, ["__bss_start__"] = true, ["_bss_end__"] = true,
        }
        local function is_marker(name)
            return markers[name] ~= nil
                or name:match("^completed%.") ~= nil
                or name:match("^object%.") ~= nil
        end

        local ram_syms = {}
        for name, entry in pairs(syms) do
            if entry.size > 0 and not name:find("__", 1, true) and not is_marker(name) then
                local section = ram_section(entry.address)
                if section then
                    table.insert(ram_syms, { name = name, size = entry.size,
                                             section = section, address = entry.address })
                end
            end
        end
        table.sort(ram_syms, function (a, b) return a.size > b.size end)
        if #ram_syms > 0 then
            local details = {}
            local total = 0
            for _, s in ipairs(ram_syms) do total = total + s.size end
            table.insert(details, string.format("%d object(s), %d B total", #ram_syms, total))
            for i = 1, math.min(8, #ram_syms) do
                table.insert(details, string.format("  %6d B  %-8s %s",
                                                    ram_syms[i].size, ram_syms[i].section,
                                                    ram_syms[i].name))
            end
            add("INFO", "ram-top", "largest RAM objects", details)
        end

        -- ==================== report ====================

        cprint("\n${bright}audit: %s${clear}\n", elf)
        cprint("${dim}       tools: %s, %s${clear}\n", nm, objd)

        local order = {FAIL = 1, WARN = 2, INFO = 3}
        local colour = {FAIL = "${red}", WARN = "${yellow}", INFO = "${dim}"}
        table.sort(report, function (a, b)
            if order[a.severity] ~= order[b.severity] then
                return order[a.severity] < order[b.severity]
            end
            return a.rule < b.rule
        end)

        local counts = {FAIL = 0, WARN = 0, INFO = 0}
        for _, item in ipairs(report) do
            counts[item.severity] = counts[item.severity] + 1
            cprint("%s[%-4s]${clear} ${bright}%-15s${clear} %s", colour[item.severity],
                   item.severity, item.rule, item.message)
            for _, line in ipairs(item.details or {}) do
                print("         " .. line)
            end
            print("")
        end

        if #report == 0 then
            print("nothing to report")
        end

        cprint("audit: %s%d fail${clear}, %s%d warn${clear}, %d info\n",
               counts.FAIL > 0 and "${red}" or "${green}", counts.FAIL,
               counts.WARN > 0 and "${yellow}" or "${dim}", counts.WARN, counts.INFO)

        if counts.FAIL > 0 then
            raise(string.format("audit failed: %d check(s)", counts.FAIL))
        end
    end)
