-- Generate Doxygen documentation

task("docs")
    set_menu {
        usage = "xmake docs [options]",
        description = "Generate Doxygen documentation",
        options = {}
    }

    on_run(function()
        import("core.project.config")
        import("core.project.project")
        config.load()

        local projectdir = os.projectdir()

        local input_dirs = {}
        local added_dirs = {}

        for name, t in pairs(project.targets()) do
            local includedirs = t:get("includedirs")
            if includedirs then
                for _, dir in ipairs(includedirs) do
                    if not path.is_absolute(dir) then
                        dir = path.join(projectdir, dir)
                    end
                    dir = path.normalize(dir)
                    
                    if not added_dirs[dir] and os.isdir(dir) then
                        table.insert(input_dirs, dir)
                        added_dirs[dir] = true
                    end
                end
            end

            local files = t:get("files")
            if files then
                for _, pattern in ipairs(files) do
                    local dir = path.directory(pattern)
                    if not path.is_absolute(dir) then
                        dir = path.join(projectdir, dir)
                    end
                    dir = path.normalize(dir)
                    
                    if dir and dir ~= "." and dir ~= projectdir and not added_dirs[dir] and os.isdir(dir) then
                        table.insert(input_dirs, dir)
                        added_dirs[dir] = true
                    end
                end
            end
        end

        local input_str = ""
        if #input_dirs > 0 then
            input_str = '"' .. table.concat(input_dirs, '" "') .. '"'
            print("Documentation input directories:")
            for _, dir in ipairs(input_dirs) do
                print("  - " .. dir)
            end
        else
            local defaults = {"app", "board", "Core/Src", "Core/Inc"}
            local abs_defaults = {}
            for _, d in ipairs(defaults) do
                local abs_d = path.join(projectdir, d)
                if os.isdir(abs_d) then
                    table.insert(abs_defaults, abs_d)
                end
            end
            input_str = '"' .. table.concat(abs_defaults, '" "') .. '"'
        end

        local tmp_doxyfile = path.join(projectdir, "Doxyfile.tmp")
        local doxyfile_src = path.join(projectdir, "Doxyfile")

        local proj_name = "My Project"
        for name, t in pairs(project.targets()) do
            local tname = t:data("project_name")
            if tname then
                proj_name = tname
                break
            end
        end

        local doxy_content = ""

        if os.isfile(doxyfile_src) then
            doxy_content = doxy_content .. "@INCLUDE = " .. doxyfile_src .. "\n"
        else
            cprint("${yellow}Warning: Doxyfile not found. Generating minimal configuration.${clear}")
            doxy_content = doxy_content .. 'PROJECT_NAME = "' .. proj_name .. '"\n'
            doxy_content = doxy_content .. 'OUTPUT_DIRECTORY = ' .. path.join(projectdir, "docs") .. '\n'
            doxy_content = doxy_content .. 'OPTIMIZE_OUTPUT_FOR_C = YES\n'
            doxy_content = doxy_content .. 'EXTRACT_ALL = YES\n'
            doxy_content = doxy_content .. 'EXTRACT_PRIVATE = YES\n'
            doxy_content = doxy_content .. 'EXTRACT_STATIC = YES\n'
            doxy_content = doxy_content .. 'GENERATE_HTML = YES\n'
            doxy_content = doxy_content .. 'GENERATE_LATEX = NO\n'
            doxy_content = doxy_content .. 'RECURSIVE = YES\n'
        end

        doxy_content = doxy_content .. 'INPUT = ' .. input_str .. '\n'
        doxy_content = doxy_content .. 'EXCLUDE_PATTERNS = "*/Drivers/CMSIS/*" "*/Drivers/STM32*/*"\n'

        io.writefile(tmp_doxyfile, doxy_content)

        os.exec("doxygen \"" .. tmp_doxyfile .. "\"")
        os.rm(tmp_doxyfile)

        local docs_index = path.join(projectdir, "docs/index.html")

        local redirect_html = table.concat({
            "<!DOCTYPE html>",
            "<html>",
            "",
            "<head>",
            "    <meta charset=\"UTF-8\">",
            "    <meta http-equiv=\"refresh\" content=\"0; URL='html/index.html'\">",
            "    <title></title>",
            "</head>",
            "",
            "</html>",
        }, "\n")
        io.writefile(docs_index, redirect_html)

        if os.isfile(path.join(projectdir, "docs/html/index.html")) then
            cprint("\r\n${green}✓ Doxygen documentation generated successfully!${clear}")
            print("  Open docs/index.html to view\r\n")
        else
            cprint("\r\n${red}ERROR: Failed to generate documentation${clear}")
        end
    end)
