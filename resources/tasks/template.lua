-- Create project structure from template

task("template")
    set_menu {
        usage = "xmake template [options]",
        description = "Create project structure from template",
        options = {
            {nil, "mcu", "v", "stm32f1", "MCU series (stm32f1, stm32f4, ...)"},
            {nil, "path", "v", "templates", "Path to templates folder"},
            {nil, "force", "k", nil, "Overwrite existing files"},
            {nil, "list", "k", nil, "List available templates"},
        }
    }
    on_run(function ()
        import("core.base.option")

        local mcu = option.get("mcu")
        local templates_path = path.normalize(path.translate(option.get("path") or "templates"))
        local force = option.get("force")
        local list_only = option.get("list")

        -- List available templates
        if list_only then
            cprint("${green}Available templates:${clear}")

            if not os.isdir(templates_path) then
                cprint("${red}  Templates folder not found: ${clear}" .. templates_path)
                print ("")
                cprint("${yellow}  Add as submodule:${clear}")
                print ("    git submodule add <repo-url> templates\r\n")
                return
            end

            local dirs = os.dirs(path.join(templates_path, "*"))
            if #dirs == 0 then
                cprint("${red}  No templates found in: ${clear}" .. templates_path)
                return
            end

            for _, d in ipairs(dirs) do
                local name = path.filename(d)
                local desc = ""

                local metafile = path.join(d, "template.lua")
                if os.isfile(metafile) then
                    local content = io.readfile(metafile)
                    if content then
                        local desc_match = content:match('description%s*=%s*"([^"]+)"')
                        if desc_match then
                            desc = " - " .. desc_match
                        end
                    end
                end

                print("  " .. name .. desc)
            end
            return
        end

        -- Check template exists
        local template_dir = path.join(templates_path, mcu)
        if not os.isdir(template_dir) then
            cprint("${red}ERROR${clear}: Template '%s' not found", mcu)
            print ("  Checked: " .. template_dir)
            cprint("\r\n${yellow}Run 'xmake template --list' to see available templates${clear}")
            return
        end

        -- Load template metadata
        local meta = {
            dirs = {"app", "board/peripherals", "Core/Inc", "Core/Src", "Drivers", ".vscode"}
        }

        local metafile = path.join(template_dir, "template.lua")
        if os.isfile(metafile) then
            local content = io.readfile(metafile)
            if content then
                local desc = content:match('description%s*=%s*"([^"]+)"')
                if desc then meta.description = desc end

                local dirs_str = content:match('dirs%s*=%s*{%s*([^}]+)%s*}')
                if dirs_str then
                    local dirs = {}
                    for dir in dirs_str:gmatch('"([^"]+)"') do
                        table.insert(dirs, dir)
                    end
                    if #dirs > 0 then meta.dirs = dirs end
                end

                meta.variables = {}
                local vars_section = content:match('variables%s*=%s*{%s*([^}]+)%s*}')
                if vars_section then
                    for key, val in vars_section:gmatch('(%w+)%s*=%s*"([^"]+)"') do
                        meta.variables[key] = val
                    end
                end
            end
        end

        print(string.rep("=", 60))
        print("Applying template: " .. mcu)
        print("  Source: " .. template_dir)
        if meta.description then
            print("  Description: " .. meta.description)
        end
        print(string.rep("=", 60))

        -- Create directories
        print("\r\nCreating directories:")
        for _, dir in ipairs(meta.dirs) do
            os.mkdir(dir)
            print("  " .. dir)
        end

        -- Copy template files
        local function copy_dir(src, dest)
            if not os.isdir(src) then return 0 end

            local count = 0

            local files = os.files(path.join(src, "*"))
            for _, f in ipairs(files) do
                local filename = path.filename(f)
                local target = path.join(dest, filename)

                if force or not os.isfile(target) then
                    os.cp(f, target)
                    print("  [COPY] " .. target)
                    count = count + 1
                else
                    print("  [SKIP] " .. target .. " (exists)")
                end
            end

            local subdirs = os.dirs(path.join(src, "*"))
            for _, subdir in ipairs(subdirs) do
                local subname = path.filename(subdir)
                local target_dir = path.join(dest, subname)
                os.mkdir(target_dir)
                count = count + copy_dir(subdir, target_dir)
            end

            return count
        end

        print("\r\nCopying template files:")
        local total_files = 0

        local entries = os.dirs(path.join(template_dir, "*"))
        for _, entry in ipairs(entries) do
            local name = path.filename(entry)
            os.mkdir(name)
            total_files = total_files + copy_dir(entry, name)
        end

        local root_files = os.files(path.join(template_dir, "*"))
        for _, f in ipairs(root_files) do
            local filename = path.filename(f)
            if filename ~= "template.lua" then
                if force or not os.isfile(filename) then
                    os.cp(f, ".")
                    print("  [COPY] " .. filename)
                    total_files = total_files + 1
                else
                    print("  [SKIP] " .. filename .. " (exists)")
                end
            end
        end

        -- Show suggested variables
        if meta.variables then
            local first = true
            for k, v in pairs(meta.variables) do
                if first then
                    print("\r\nSuggested xmake.lua variables:")
                    first = false
                end
                print("  " .. k .. ' = "' .. v .. '"')
            end
        end

        print("")
        print(string.rep("=", 60))
        cprint("${green}Template '%s' applied!${clear} (%d files)", mcu, total_files)
        print(string.rep("=", 60))
    end)
task_end()
