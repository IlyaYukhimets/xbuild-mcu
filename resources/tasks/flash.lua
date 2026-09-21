-- Flash through JLink

task("flash")
    set_menu {
        usage = "xmake flash [options]",
        description = "Flash firmware via JLink",
        -- `--target` must be declared here to be registered: set_menu recognises only
        -- usage/description/options/tasks/category/shortname, so a bare `target = true`
        -- is ignored and the flag is then rejected as an unknown option. The option is
        -- what makes `xmake flash --target=<board>` parseable (same shape as audit.lua).
        options = {
            {nil, "target", "kv", nil, "target to flash (required when the project has several)"},
            {nil, "device", "kv", nil, "MCU device name"},
            {nil, "speed", "kv", "4000", "JLink speed (kHz)"},
        }
    }
    on_run(function (target)
        import("core.project.project")
        import("core.base.option")

        local targetfile = nil

        -- A repository may build several firmware targets (one per board). Resolve the
        -- one to flash: an explicit --target wins, then a legacy "firmware" target,
        -- then the only target there is. With several targets and no --target the
        -- choice would be arbitrary (and flashing the wrong image is destructive), so
        -- it is reported instead of guessed.
        local target_name = option.get("target")
        if not target_name or target_name == "" then
            if project.target("firmware") then
                target_name = "firmware"
            else
                local names = {}
                for tname, _ in pairs(project.targets() or {}) do
                    table.insert(names, tname)
                end
                table.sort(names)
                if #names == 1 then
                    target_name = names[1]
                elseif #names == 0 then
                    cprint("${red}ERROR: no targets in the project${clear}")
                    return
                else
                    cprint("${red}ERROR: several targets; pass --target=<name>: %s${clear}", table.concat(names, ", "))
                    return
                end
            end
        end

        local t = project.target(target_name)

        local candidates = {}
        if t then
            table.insert(candidates, path.normalize(t:targetfile()))
        end

        local mode = get_config("mode") or "debug"
        local project_name = (t and t:data("project_name")) or target_name
        table.insert(candidates, path.join("build/cross/arm", mode, project_name .. ".elf"))
        table.insert(candidates, path.join("build", project_name .. ".elf"))

        for _, candidate in ipairs(candidates) do
            if os.isfile(candidate) then
                targetfile = candidate
                break
            end
        end

        if not targetfile then
            cprint("${red}ERROR: ELF file not found!${clear}")
            print("Run 'xmake' first to build the project")
            return
        end

        local device = option.get("device") or t:data("mcu_device")
        local speed  = option.get("speed") or "4000"

        local script_file = path.join(os.projectdir(), "build/jlink_flash.jlink")
        os.mkdir(path.directory(script_file))

        local script_content = table.concat({
            "device " .. device,
            "si SWD",
            "speed " .. speed,
            "loadfile " .. path.absolute(targetfile),
            "r",
            "g",
            "exit"
        }, "\n")
        io.writefile(script_file, script_content)

        cprint("\r\n${green rocket} Flashing via JLink...${clear}")
        print("  Device: " .. device)
        print("  Speed:  " .. speed .. " kHz")
        print("  File:   " .. targetfile)

        local jlink = "JLink.exe"
        if t:data("jlink_path") and #t:data("jlink_path") > 0 then
            jlink = path.normalize(t:data("jlink_path"))
        end

        local outdata, errdata = "", ""
        try
        {
            function ()
                outdata, errdata = os.iorunv(jlink, {
                    "-ExitOnError", "1",
                    "-CommandFile", script_file
                })
            end,
            catch
            {
                function (errors)
                    errdata = tostring(errors)
                end
            }
        }

        local output = (outdata or "") .. "\n" .. (errdata or "")
        if output ~= "" then
            print(output)
        end

        os.rm(script_file)

        local has_critical_error = false
        local error_name = nil

        local critical_errors = {
            "Error occurred: Could not connect to the target device.",
            "Error: Failed to initialize DAP.",
            "FAILED: Cannot connect to J-Link.",
        }

        for _, pattern in ipairs(critical_errors) do
            if output:find(pattern, 1, true) then
                has_critical_error = true
                error_name = pattern
                break
            end
        end

        if has_critical_error then
            cprint("${red x} ERROR: J-Link flashing failed! " .. error_name .. "${clear}")
            return
        end

        cprint("${green white_check_mark} Flash completed successfully!${clear}")
    end)
