-- Import from CubeMX project

task("cubemx")
    set_menu {
        usage = "xmake cubemx --path=PATH",
        description = "Import files from CubeMX project",
        options = {
            {nil, "path", "v", nil, "Path to CubeMX project (required)"},
        }
    }
    on_run(function ()
        import("core.base.option")

        local cubemx_path = option.get("path")

        if not cubemx_path then
            print("ERROR: --path is required")
            print("Usage: xmake cubemx --path=/path/to/cubemx/project")
            return
        end

        cubemx_path = path.normalize(path.translate(cubemx_path))

        print(string.rep("=", 60))
        cprint("${green}Importing from CubeMX${clear}")
        print("  Source: " .. cubemx_path)
        print(string.rep("=", 60))

        if not os.isdir(cubemx_path) then
            cprint("${red}ERROR: Path not found!${clear}")
            return
        end

        local imported = 0

        -- 1. Core/Inc - stm32_assert.h
        local cubemx_inc = path.join(cubemx_path, "Core/Inc")
        if os.isdir(cubemx_inc) then
            local files = os.files(path.join(cubemx_inc, "*assert.h"))
            for _, f in ipairs(files) do
                os.cp(f, "Core/Inc/")
                print("  [COPY] Core/Inc/" .. path.filename(f))
                imported = imported + 1
            end
        end

        -- 2. Core/Src - system files only
        local cubemx_src = path.join(cubemx_path, "Core/Src")
        if os.isdir(cubemx_src) then
            local patterns = {"syscalls.c", "sysmem.c", "system_*.c"}
            for _, p in ipairs(patterns) do
                local files = os.files(path.join(cubemx_src, p))
                for _, f in ipairs(files) do
                    os.cp(f, "Core/Src/")
                    print("  [COPY] Core/Src/" .. path.filename(f))
                    imported = imported + 1
                end
            end
        end

        -- 3. Startup file
        local startup_dirs = {
            path.join(cubemx_path, "Core/Startup"),
            cubemx_path
        }
        for _, d in ipairs(startup_dirs) do
            if os.isdir(d) then
                local files = os.files(path.join(d, "startup_*.s"))
                if #files > 0 then
                    os.cp(files[1], "Core/")
                    print("  [COPY] Core/" .. path.filename(files[1]))
                    imported = imported + 1
                    break
                end
            end
        end

        -- 4. Linker script
        local ld_files = os.files(path.join(cubemx_path, "*.ld"))
        if #ld_files > 0 then
            os.cp(ld_files[1], ".")
            print("  [COPY] " .. path.filename(ld_files[1]))
            imported = imported + 1
        end

        -- 5. Drivers
        local drivers = path.join(cubemx_path, "Drivers")
        if os.isdir(drivers) then
            local cmsis = path.join(drivers, "CMSIS")
            if os.isdir(cmsis) then
                os.cp(cmsis, "Drivers/")
                print("  [COPY] Drivers/CMSIS/")
                imported = imported + 1
            end

            local hal_dirs = os.dirs(path.join(drivers, "STM32*"))
            for _, d in ipairs(hal_dirs) do
                os.cp(d, "Drivers/")
                print("  [COPY] Drivers/" .. path.filename(d) .. "/")
                imported = imported + 1
            end
        end

        print("")
        print(string.rep("=", 60))
        print("Imported %d items", imported)
        print(string.rep("=", 60))
    end)
task_end()
