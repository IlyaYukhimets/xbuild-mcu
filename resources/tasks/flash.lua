-- Flash through JLink

task("flash")
    set_menu {
        usage = "xmake flash [options]",
        description = "Flash firmware via JLink",
        target = true,
        options = {
            {nil, "device", "kv", nil, "MCU device name"},
            {nil, "speed", "kv", "4000", "JLink speed (kHz)"},
        }
    }
    on_run(function (target)
        import("core.project.project")
        import("core.base.option")

        local targetfile = nil
        local target_name = option.get("target") or "firmware"
        local t = project.target(target_name)

        local candidates = {}
        if t then
            table.insert(candidates, path.normalize(t:targetfile()))
        end

        local mode = get_config("mode") or "debug"
        table.insert(candidates, path.join("build/cross/arm", mode, t:data("project_name") .. ".elf"))
        table.insert(candidates, path.join("build", t:data("project_name") .. ".elf"))

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
