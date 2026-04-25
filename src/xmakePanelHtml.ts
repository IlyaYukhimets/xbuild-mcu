import { XmakeConfig, OPTIMIZATION_PRESETS } from './xmakeConfigParser';

// ============================================================================
// MCU Presets Configuration
// ============================================================================

interface McuPreset {
    MCU_SERIES: string;
    MCU_CORE: string;
    MCU_DEVICE: string;
    LD_SCRIPT: string;
    SVD_FILE: string;
}

const MCU_PRESETS: Record<string, McuPreset & { label: string }> = {
    'STM32F103': {
        label: 'STM32F103 (Blue Pill)',
        MCU_SERIES: 'STM32F103xB',
        MCU_CORE: 'cortex-m3',
        MCU_DEVICE: 'STM32F103C8',
        LD_SCRIPT: 'STM32F103XX_FLASH.ld',
        SVD_FILE: 'STM32F103.svd'
    },
    'STM32F401': {
        label: 'STM32F401 (Black Pill)',
        MCU_SERIES: 'STM32F401xC',
        MCU_CORE: 'cortex-m4',
        MCU_DEVICE: 'STM32F401CC',
        LD_SCRIPT: 'STM32F401CCUx_FLASH.ld',
        SVD_FILE: 'STM32F401.svd'
    },
    'STM32F407': {
        label: 'STM32F407 (Discovery)',
        MCU_SERIES: 'STM32F407xx',
        MCU_CORE: 'cortex-m4',
        MCU_DEVICE: 'STM32F407VG',
        LD_SCRIPT: 'STM32F407VGTx_FLASH.ld',
        SVD_FILE: 'STM32F407.svd'
    },
    'STM32F411': {
        label: 'STM32F411 (Black Pill)',
        MCU_SERIES: 'STM32F411xE',
        MCU_CORE: 'cortex-m4',
        MCU_DEVICE: 'STM32F411CE',
        LD_SCRIPT: 'STM32F411CEUx_FLASH.ld',
        SVD_FILE: 'STM32F411.svd'
    },
    'STM32F429': {
        label: 'STM32F429 (Discovery with LCD)',
        MCU_SERIES: 'STM32F429xx',
        MCU_CORE: 'cortex-m4',
        MCU_DEVICE: 'STM32F429ZI',
        LD_SCRIPT: 'STM32F429ZITx_FLASH.ld',
        SVD_FILE: 'STM32F429.svd'
    },
    'STM32H743': {
        label: 'STM32H743 (Nucleo)',
        MCU_SERIES: 'STM32H743xx',
        MCU_CORE: 'cortex-m7',
        MCU_DEVICE: 'STM32H743ZI',
        LD_SCRIPT: 'STM32H743ZITx_FLASH.ld',
        SVD_FILE: 'STM32H743.svd'
    },
    'STM32L476': {
        label: 'STM32L476 (Nucleo Low Power)',
        MCU_SERIES: 'STM32L476xx',
        MCU_CORE: 'cortex-m4',
        MCU_DEVICE: 'STM32L476RG',
        LD_SCRIPT: 'STM32L476RGTx_FLASH.ld',
        SVD_FILE: 'STM32L476.svd'
    }
};

// Default paths for STM32F103 project structure
const STM32F103_DEFAULTS = {
    defines: ['USE_FULL_LL_DRIVER'],
    includes: [
        'app',
        'board',
        'board/peripherals',
        'Core/Inc',
        'Drivers/CMSIS/Device/ST/STM32F1xx/Include',
        'Drivers/CMSIS/Include',
        'Drivers/STM32F1xx_HAL_Driver/Inc'
    ],
    sources: [
        'app/*.cpp',
        'board/*.cpp',
        'board/peripherals/*.cpp',
        'Core/Src/*.c',
        'Drivers/STM32F1xx_HAL_Driver/Src/*.c',
        'Core/startup_*.s'
    ]
};

// ============================================================================
// HTML Generation
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
    if (!str) { return ''; }
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Generate MCU preset options HTML
 */
function generatePresetOptions(): string {
    return Object.entries(MCU_PRESETS)
        .map(([value, preset]) => `<option value="${value}">${preset.label}</option>`)
        .join('\n                    ');
}

/**
 * Generate MCU presets JavaScript object
 */
function generatePresetsJs(): string {
    const presetsObj: Record<string, Omit<McuPreset, 'label'>> = {};
    for (const [key, preset] of Object.entries(MCU_PRESETS)) {
        presetsObj[key] = {
            MCU_SERIES: preset.MCU_SERIES,
            MCU_CORE: preset.MCU_CORE,
            MCU_DEVICE: preset.MCU_DEVICE,
            LD_SCRIPT: preset.LD_SCRIPT,
            SVD_FILE: preset.SVD_FILE
        };
    }
    return JSON.stringify(presetsObj);
}

/**
 * Generate optimization preset options HTML
 */
function generateOptimizationOptions(selectedId: string): string {
    return OPTIMIZATION_PRESETS
        .map(preset => `<option value="${preset.id}" ${preset.id === selectedId ? 'selected' : ''}>${preset.name}</option>`)
        .join('\n                        ');
}

/**
 * Generate optimization presets JavaScript object
 */
function generateOptimizationPresetsJs(): string {
    const presetsObj: Record<string, { name: string; description: string; cflags: string; debugLevel: number; lto: boolean }> = {};
    for (const preset of OPTIMIZATION_PRESETS) {
        presetsObj[preset.id] = {
            name: preset.name,
            description: preset.description,
            cflags: preset.cflags,
            debugLevel: preset.debugLevel,
            lto: preset.lto
        };
    }
    return JSON.stringify(presetsObj);
}

/**
 * Generate optimization levels list HTML for collapsible section
 */
function generateOptimizationLevelsList(): string {
    return OPTIMIZATION_PRESETS.map(p => `
                <div style="padding: 10px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">${p.name}</div>
                    <div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 6px;">${p.description}</div>
                    <div style="font-family: monospace; font-size: 0.8em; color: var(--vscode-textPreformat-foreground);">
                        CFLAGS: ${p.cflags} | Debug: -g${p.debugLevel}${p.lto ? ' | LTO: enabled' : ''}
                    </div>
                </div>`).join('');
}

/**
 * CSS styles for the panel
 */
const CSS_STYLES = `
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            max-width: 900px;
            margin: 0 auto;
        }
        h1 {
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .warning-banner {
            background: rgba(255, 152, 0, 0.2);
            border: 1px solid #ff9800;
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .warning-banner.hidden {
            display: none;
        }
        .warning-text {
            color: #ff9800;
        }
        .btn-create {
            background: #4caf50;
            color: white;
            padding: 8px 16px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .btn-create:hover {
            background: #388e3c;
        }
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-panel-border);
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .tab {
            padding: 10px 15px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -2px;
            color: var(--vscode-descriptionForeground);
            font-size: 1.0em;
            font-weight: 500;
        }
        .tab:hover {
            color: var(--vscode-foreground);
        }
        .tab.active {
            color: var(--vscode-foreground);
            border-bottom-color: var(--vscode-focusBorder);
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .section {
            margin-bottom: 25px;
        }
        .section-title {
            font-size: 1.2em;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .field {
            margin-bottom: 15px;
        }
        .field label {
            display: block;
            font-weight: 500;
            margin-bottom: 5px;
        }
        .field input, .field select {
            width: 100%;
            padding: 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        .field input:focus, .field select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .field input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .field-hint {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            margin-top: 3px;
        }
        .field-with-browse {
            display: flex;
            gap: 8px;
        }
        .field-with-browse input {
            flex: 1;
        }
        .browse-btn {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .browse-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .preset-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 15px;
        }
        .preset-row select {
            flex: 1;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        .preset-row select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .preset-row select option {
            background: var(--vscode-editor-background);
            color: var(--vscode-input-foreground);
        }
        .opt-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        @media (max-width: 600px) {
            .opt-group {
                grid-template-columns: 1fr;
            }
        }
        .opt-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 15px;
        }
        .opt-card-title {
            font-weight: 600;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .opt-card-title .icon {
            font-size: 1.2em;
        }
        .opt-desc {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            padding: 8px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            margin-top: 10px;
            line-height: 1.4;
        }
        .list-container {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .list-item {
            display: flex;
            align-items: center;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .list-item:last-child {
            border-bottom: none;
        }
        .list-item input {
            flex: 1;
            padding: 4px;
            background: transparent;
            border: none;
            color: var(--vscode-input-foreground);
        }
        .list-item input:focus {
            outline: none;
            background: var(--vscode-input-background);
        }
        .drag-handle {
            cursor: move;
            margin-right: 8px;
            color: var(--vscode-descriptionForeground);
        }
        .delete-btn {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
        }
        .delete-btn:hover {
            background: var(--vscode-errorBackground);
        }
        .add-item {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }
        .add-item input {
            flex: 1;
            padding: 6px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        .add-item button {
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        .buttons {
            margin-top: 30px;
            display: flex;
            gap: 10px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .btn {
            padding: 8px 20px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 1em;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .reset-btn-right {
            margin-left: auto;
            background: var(--vscode-descriptionForeground);
        }
        .reset-hint-bottom {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            text-align: right;
            font-style: italic;
        }
        .empty-hint {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
            text-align: center;
        }
        .git-status {
            padding: 10px;
            margin-bottom: 15px;
            border-radius: 4px;
            text-align: center;
        }
        .git-status.ok {
            background: rgba(0, 128, 0, 0.2);
            color: #4caf50;
        }
        .git-status.warning {
            background: rgba(255, 152, 0, 0.2);
            color: #ff9800;
        }
        .subsection {
            margin-top: 15px;
        }
        .subsection-title {
            font-size: 1em;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }
        .repo-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .repo-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .repo-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .repo-name {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .repo-url {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            font-family: monospace;
        }
        .repo-actions {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .btn-small {
            padding: 4px 12px;
            font-size: 0.85em;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .btn-add {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-add:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-remove {
            background: #d32f2f;
            color: white;
        }
        .btn-remove:hover {
            background: #b71c1c;
        }
        .installed-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            background: #4caf50;
            color: white;
            border-radius: 12px;
            font-size: 0.8em;
        }
        /* Collapsible section styles */
        .collapsible-section {
            margin-bottom: 25px;
        }
        .collapsible-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            padding: 8px 12px;
            background: var(--vscode-list-hoverBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            user-select: none;
            transition: background 0.2s ease;
        }
        .collapsible-header:hover {
            background: var(--vscode-list-activeSelectionBackground);
        }
        .collapsible-header-text {
            font-size: 1.0em;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .collapsible-arrow {
            transition: transform 0.2s ease;
            font-size: 0.7em;
            color: var(--vscode-descriptionForeground);
        }
        .collapsible-arrow.expanded {
            transform: rotate(90deg);
        }
        .collapsible-content-wrapper {
            overflow: hidden;
            transition: max-height 0.3s ease-out, opacity 0.2s ease-out;
            max-height: 0;
            opacity: 0;
        }
        .collapsible-content-wrapper.expanded {
            max-height: 2000px;
            opacity: 1;
        }
        .collapsible-content-inner {
            padding: 15px 0 0 0;
            display: grid;
            gap: 10px;
        }`;

/**
 * Client-side JavaScript code
 */
function generateClientScript(config: XmakeConfig): string {
    return `
        var vscode = acquireVsCodeApi();

        // Initialize data
        var defines = ${JSON.stringify(config.DEFINES)};
        var includes = ${JSON.stringify(config.INCLUDE_DIRS)};
        var sources = ${JSON.stringify(config.SOURCE_FILES)};

        // STM32F103 default paths
        var stm32f103Defaults = ${JSON.stringify(STM32F103_DEFAULTS)};

        // MCU presets
        var mcuPresets = ${generatePresetsJs()};

        // Optimization presets
        var optPresets = ${generateOptimizationPresetsJs()};

        var submodulesRepos = [];
        var installedSubmodules = [];
        var isGitRepo = false;

        // Escape HTML for XSS prevention
        function escapeHtml(str) {
            if (!str) { return ''; }
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function resetToSTM32F103Defaults() {
            defines = stm32f103Defaults.defines.slice();
            includes = stm32f103Defaults.includes.slice();
            sources = stm32f103Defaults.sources.slice();
            renderAllLists();
        }

        function createXmakeFile() {
            vscode.postMessage({ command: 'createXmakeFile' });
        }

        function showTab(tabName) {
            var tabs = document.querySelectorAll('.tab');
            var contents = document.querySelectorAll('.tab-content');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.remove('active');
            }
            for (var i = 0; i < contents.length; i++) {
                contents[i].classList.remove('active');
            }
            document.querySelector('.tab[onclick="showTab(\\'' + tabName + '\\')"]').classList.add('active');
            document.getElementById('tab-' + tabName).classList.add('active');
            
            var resetBtn = document.getElementById('reset-btn');
            var resetHint = document.getElementById('reset-hint');
            var showReset = (tabName === 'defines' || tabName === 'includes' || tabName === 'sources');
            if (resetBtn) { resetBtn.style.display = showReset ? 'block' : 'none'; }
            if (resetHint) { resetHint.style.display = showReset ? 'block' : 'none'; }
            
            if (tabName === 'submodules') {
                loadSubmodules();
            }
        }

        function applyPreset() {
            var preset = document.getElementById('mcuPreset').value;
            if (preset && mcuPresets[preset]) {
                var data = mcuPresets[preset];
                document.getElementById('MCU_SERIES').value = data.MCU_SERIES;
                document.getElementById('MCU_CORE').value = data.MCU_CORE;
                document.getElementById('MCU_DEVICE').value = data.MCU_DEVICE;
                document.getElementById('LD_SCRIPT').value = data.LD_SCRIPT;
                document.getElementById('SVD_FILE').value = data.SVD_FILE;
            }
        }

        function updateOptDescription(selectId, descId) {
            var select = document.getElementById(selectId);
            var descEl = document.getElementById(descId);
            var presetId = select.value;
            if (optPresets[presetId]) {
                descEl.textContent = optPresets[presetId].description;
            }
        }

        function toggleCollapsible(headerEl) {
            var arrow = headerEl.querySelector('.collapsible-arrow');
            var content = headerEl.nextElementSibling;
            
            if (content.classList.contains('expanded')) {
                content.classList.remove('expanded');
                arrow.classList.remove('expanded');
            } else {
                content.classList.add('expanded');
                arrow.classList.add('expanded');
            }
        }

        function renderList(listId, items, listType) {
            var container = document.getElementById(listId);
            var html = '';
            for (var i = 0; i < items.length; i++) {
                html += '<div class="list-item">';
                html += '<span class="drag-handle">⋮⋮</span>';
                html += '<input type="text" value="' + escapeHtml(items[i]) + '" onchange="updateItem(\\'' + listType + '\\', ' + i + ', this.value)">';
                html += '<button class="delete-btn" onclick="deleteItem(\\'' + listType + '\\', ' + i + ')">✕</button>';
                html += '</div>';
            }
            container.innerHTML = html;
        }

        function updateItem(listType, index, value) {
            if (listType === 'defines') defines[index] = value;
            else if (listType === 'includes') includes[index] = value;
            else if (listType === 'sources') sources[index] = value;
        }

        function deleteItem(listType, index) {
            var arr;
            if (listType === 'defines') arr = defines;
            else if (listType === 'includes') arr = includes;
            else arr = sources;
            arr.splice(index, 1);
            renderAllLists();
        }

        function addItem(listType) {
            var input;
            if (listType === 'defines') {
                input = document.getElementById('new-define');
                defines.push(input.value);
            } else if (listType === 'includes') {
                input = document.getElementById('new-include');
                includes.push(input.value);
            } else {
                input = document.getElementById('new-source');
                sources.push(input.value);
            }
            input.value = '';
            renderAllLists();
        }

        function renderAllLists() {
            renderList('defines-list', defines, 'defines');
            renderList('includes-list', includes, 'includes');
            renderList('sources-list', sources, 'sources');
        }

        renderAllLists();

        function getFormValues() {
            return {
                PROJECT_NAME: document.getElementById('PROJECT_NAME').value,
                MCU_SERIES: document.getElementById('MCU_SERIES').value,
                MCU_CORE: document.getElementById('MCU_CORE').value,
                MCU_DEVICE: document.getElementById('MCU_DEVICE').value,
                LD_SCRIPT: document.getElementById('LD_SCRIPT').value,
                SVD_FILE: document.getElementById('SVD_FILE').value,
                JLINK_PATH: document.getElementById('JLINK_PATH').value,
                ARM_GCC: document.getElementById('ARM_GCC').value,
                DEFINES: defines,
                INCLUDE_DIRS: includes,
                SOURCE_FILES: sources,
                OPTIMIZATION_DEBUG: document.getElementById('OPTIMIZATION_DEBUG').value,
                OPTIMIZATION_RELEASE: document.getElementById('OPTIMIZATION_RELEASE').value
            };
        }

        function save() {
            vscode.postMessage({ command: 'save', config: getFormValues() });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        function browseFile(field, filters) {
            var extensions = filters.split(',');
            var cleanExtensions = [];
            for (var i = 0; i < extensions.length; i++) {
                var ext = extensions[i].trim();
                if (ext.startsWith('.')) { ext = ext.substring(1); }
                cleanExtensions.push(ext);
            }
            vscode.postMessage({ 
                command: 'browseFile', 
                field: field, 
                filters: { 'Files': cleanExtensions },
                currentValue: document.getElementById(field).value
            });
        }

        function browseFolder(field) {
            vscode.postMessage({ 
                command: 'browseFolder', 
                field: field,
                currentValue: document.getElementById(field).value
            });
        }

        function loadSubmodules() {
            vscode.postMessage({ command: 'getSubmodules' });
        }

        function renderSubmodules() {
            var statusEl = document.getElementById('git-status');
            if (isGitRepo) {
                statusEl.className = 'git-status ok';
                statusEl.innerHTML = '✓ Git repository initialized';
            } else {
                statusEl.className = 'git-status warning';
                statusEl.innerHTML = '⚠ Not a git repository. Click Add to initialize.';
            }

            var availableEl = document.getElementById('available-repos');
            var availableHtml = '';
            for (var i = 0; i < submodulesRepos.length; i++) {
                var repo = submodulesRepos[i];
                var isInstalled = installedSubmodules.indexOf(repo.name) !== -1;
                availableHtml += '<div class="repo-item">';
                availableHtml += '<div class="repo-info">';
                availableHtml += '<div class="repo-name">' + escapeHtml(repo.name) + '</div>';
                availableHtml += '<div class="repo-url">' + escapeHtml(repo.url) + '</div>';
                availableHtml += '</div>';
                availableHtml += '<div class="repo-actions">';
                if (isInstalled) {
                    availableHtml += '<span class="installed-badge">✓ Installed</span>';
                } else {
                    availableHtml += '<button class="btn-small btn-add" onclick="addSubmodule(\\'' + escapeHtml(repo.name) + '\\')">Add</button>';
                }
                availableHtml += '</div>';
                availableHtml += '</div>';
            }
            availableEl.innerHTML = availableHtml;

            var installedEl = document.getElementById('installed-submodules');
            if (installedSubmodules.length === 0) {
                installedEl.innerHTML = '<div class="empty-hint">No submodules installed</div>';
            } else {
                var installedHtml = '';
                for (var i = 0; i < installedSubmodules.length; i++) {
                    var sm = installedSubmodules[i];
                    installedHtml += '<div class="repo-item">';
                    installedHtml += '<div class="repo-info">';
                    installedHtml += '<div class="repo-name">' + escapeHtml(sm) + '</div>';
                    installedHtml += '</div>';
                    installedHtml += '<div class="repo-actions">';
                    installedHtml += '<button class="btn-small btn-remove" onclick="removeSubmodule(\\'' + escapeHtml(sm) + '\\')">Remove</button>';
                    installedHtml += '</div>';
                    installedHtml += '</div>';
                }
                installedEl.innerHTML = installedHtml;
            }
        }

        function addSubmodule(repoName) {
            vscode.postMessage({ command: 'addSubmodule', repoName: repoName });
        }

        function removeSubmodule(path) {
            vscode.postMessage({ command: 'removeSubmodule', path: path });
        }

        window.addEventListener('message', function(event) {
            var message = event.data;
            if (message.command === 'setFile') {
                document.getElementById(message.field).value = message.value;
            } else if (message.command === 'submodulesData') {
                submodulesRepos = message.repos;
                installedSubmodules = message.installed;
                isGitRepo = message.isGitRepo;
                renderSubmodules();
            } else if (message.command === 'xmakeCreated') {
                var banner = document.getElementById('no-xmake-banner');
                if (banner) { banner.classList.add('hidden'); }
            }
        });

        document.getElementById('new-define').addEventListener('keypress', function(e) { 
            if (e.key === 'Enter') addItem('defines'); 
        });
        document.getElementById('new-include').addEventListener('keypress', function(e) { 
            if (e.key === 'Enter') addItem('includes'); 
        });
        document.getElementById('new-source').addEventListener('keypress', function(e) { 
            if (e.key === 'Enter') addItem('sources'); 
        });

        // Initialize optimization descriptions
        updateOptDescription('OPTIMIZATION_DEBUG', 'opt-debug-desc');
        updateOptDescription('OPTIMIZATION_RELEASE', 'opt-release-desc');`;
}

export class XmakePanelHtml {

    public getHtmlContent(config: XmakeConfig, xmakeExists: boolean): string {
        const warningBanner = !xmakeExists ? `
    <div class="warning-banner" id="no-xmake-banner">
        <span class="warning-text">⚠️ xmake.lua not found in project folder</span>
        <button class="btn-create" onclick="createXmakeFile()">📄 Create xmake.lua</button>
    </div>` : '';

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Xmake Configuration</title>
    <style>${CSS_STYLES}</style>
</head>
<body>
    <h1>⚙️ Xmake Configuration</h1>
    ${warningBanner}

    <div class="tabs">
        <div class="tab active" onclick="showTab('mcu')">MCU</div>
        <div class="tab" onclick="showTab('optimization')">Optimization</div>
        <div class="tab" onclick="showTab('paths')">Paths</div>
        <div class="tab" onclick="showTab('defines')">Defines</div>
        <div class="tab" onclick="showTab('includes')">Includes</div>
        <div class="tab" onclick="showTab('sources')">Sources</div>
        <div class="tab" onclick="showTab('submodules')">Submodules</div>
    </div>

    <!-- MCU Settings Tab -->
    <div id="tab-mcu" class="tab-content active">
        <div class="section">
            <div class="section-title">🎯 MCU Preset</div>
            <div class="preset-row">
                <select id="mcuPreset" onchange="applyPreset()">
                    <option value="">-- Select MCU Preset --</option>
                    ${generatePresetOptions()}
                </select>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">🔧 Project Settings</div>
            <div class="field">
                <label for="PROJECT_NAME">Project Name</label>
                <input type="text" id="PROJECT_NAME" value="${escapeHtml(config.PROJECT_NAME)}" placeholder="my_project">
            </div>
            <div class="field">
                <label for="MCU_SERIES">MCU Series</label>
                <input type="text" id="MCU_SERIES" value="${escapeHtml(config.MCU_SERIES)}" placeholder="e.g., STM32F103xB">
                <div class="field-hint">MCU series define (passed to compiler)</div>
            </div>
            <div class="field">
                <label for="MCU_CORE">MCU Core</label>
                <input type="text" id="MCU_CORE" value="${escapeHtml(config.MCU_CORE)}" placeholder="e.g., cortex-m3, cortex-m4, cortex-m7">
            </div>
            <div class="field">
                <label for="MCU_DEVICE">MCU Device</label>
                <input type="text" id="MCU_DEVICE" value="${escapeHtml(config.MCU_DEVICE)}" placeholder="e.g., STM32F103C8">
                <div class="field-hint">Device name for JLink</div>
            </div>
            <div class="field">
                <label for="LD_SCRIPT">Linker Script</label>
                <input type="text" id="LD_SCRIPT" value="${escapeHtml(config.LD_SCRIPT)}" placeholder="e.g., STM32F103XB_FLASH.ld">
            </div>
            <div class="field">
                <label for="SVD_FILE">SVD File</label>
                <input type="text" id="SVD_FILE" value="${escapeHtml(config.SVD_FILE)}" placeholder="e.g., STM32F103.svd">
                <div class="field-hint">SVD file for debugger peripheral view</div>
            </div>
        </div>
    </div>

    <!-- Optimization Tab -->
    <div id="tab-optimization" class="tab-content">
        <div class="section">
            <div class="section-title">⚡ Optimization Presets</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground);">
                Select optimization levels for Debug and Release builds. These settings control GCC compiler flags.
            </p>
            
            <div class="opt-group">
                <div class="opt-card">
                    <div class="opt-card-title">
                        <span class="icon">🐛</span>
                        Debug Build
                    </div>
                    <div class="field">
                        <label for="OPTIMIZATION_DEBUG">Optimization Level</label>
                        <select id="OPTIMIZATION_DEBUG" onchange="updateOptDescription('OPTIMIZATION_DEBUG', 'opt-debug-desc')">
                            ${generateOptimizationOptions(config.OPTIMIZATION_DEBUG || 'debug')}
                        </select>
                    </div>
                    <div id="opt-debug-desc" class="opt-desc">
                        ${OPTIMIZATION_PRESETS.find(p => p.id === (config.OPTIMIZATION_DEBUG || 'debug'))?.description || ''}
                    </div>
                </div>
                
                <div class="opt-card">
                    <div class="opt-card-title">
                        <span class="icon">🚀</span>
                        Release Build
                    </div>
                    <div class="field">
                        <label for="OPTIMIZATION_RELEASE">Optimization Level</label>
                        <select id="OPTIMIZATION_RELEASE" onchange="updateOptDescription('OPTIMIZATION_RELEASE', 'opt-release-desc')">
                            ${generateOptimizationOptions(config.OPTIMIZATION_RELEASE || 'release')}
                        </select>
                    </div>
                    <div id="opt-release-desc" class="opt-desc">
                        ${OPTIMIZATION_PRESETS.find(p => p.id === (config.OPTIMIZATION_RELEASE || 'release'))?.description || ''}
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Collapsible Available Optimization Levels Section -->
        <div class="collapsible-section">
            <div class="collapsible-header" onclick="toggleCollapsible(this)">
                <span class="collapsible-header-text">📋 Available Optimization Levels</span>
                <span class="collapsible-arrow">▶</span>
            </div>
            <div class="collapsible-content-wrapper">
                <div class="collapsible-content-inner">
                    ${generateOptimizationLevelsList()}
                </div>
            </div>
        </div>
    </div>

    <!-- Paths Tab -->
    <div id="tab-paths" class="tab-content">
        <div class="section">
            <div class="section-title">📁 Paths</div>
            <div class="field">
                <details style="margin-bottom: 5px;">
                    <summary style="cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 1.0em;">
                        ARM GCC Path
                    </summary>
                    <p style="margin-top: 10px; color: var(--vscode-descriptionForeground);">
                        It's like "c:/ST/STM32CubeIDE_1.19.0/STM32CubeIDE/plugins/com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32.14.3.rel1.win32_1.0.0.202510090749/tools" from STMC32ubeIDE.
                    </p>
                </details>

                <div class="field-with-browse">
                    <input type="text" id="ARM_GCC" value="${escapeHtml(config.ARM_GCC)}" placeholder="Path to ARM GCC">
                    <button class="browse-btn" onclick="browseFolder('ARM_GCC')">Browse</button>
                </div>
            </div>
            <div class="field">
                <label for="JLINK_PATH">JLink Path</label>
                <div class="field-with-browse">
                    <input type="text" id="JLINK_PATH" value="${escapeHtml(config.JLINK_PATH)}" placeholder="Path to JLink.exe">
                    <button class="browse-btn" onclick="browseFile('JLINK_PATH', 'exe')">Browse</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Defines Tab -->
    <div id="tab-defines" class="tab-content">
        <div class="section">
            <div class="section-title">📝 Preprocessor Defines</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground);">
                Click "Reset to STM32F103 Defaults" for an example.
            </p>
            <div class="list-container" id="defines-list"></div>
            <div class="add-item">
                <input type="text" id="new-define" placeholder="Add new define...">
                <button onclick="addItem('defines')">Add</button>
            </div>
        </div>
    </div>

    <!-- Includes Tab -->
    <div id="tab-includes" class="tab-content">
        <div class="section">
            <div class="section-title">📁 Include Directories</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground);">
                Click "Reset to STM32F103 Defaults" for an example.
            </p>
            <div class="list-container" id="includes-list"></div>
            <div class="add-item">
                <input type="text" id="new-include" placeholder="Add new include path...">
                <button onclick="addItem('includes')">Add</button>
            </div>
        </div>
    </div>

    <!-- Sources Tab -->
    <div id="tab-sources" class="tab-content">
        <div class="section">
            <div class="section-title">📄 Source Files & Startup</div>
            <p style="margin-bottom: 20px; color: var(--vscode-descriptionForeground);">
                Set all *.c/*.cpp files. Don't foget set .s file. Click "Reset to STM32F103 Defaults" for an example.
            </p>
            <div class="list-container" id="sources-list"></div>
            <div class="add-item">
                <input type="text" id="new-source" placeholder="Add new source pattern...">
                <button onclick="addItem('sources')">Add</button>
            </div>
        </div>
    </div>

    <!-- Submodules Tab -->
    <div id="tab-submodules" class="tab-content">
        <div class="section">
            <div class="section-title">📦 Git Submodules</div>
            <div id="git-status" class="git-status"></div>
            
            <div class="subsection">
                <div class="subsection-title">Available Repositories</div>
                <div id="available-repos" class="repo-list">
                    <div class="empty-hint">Loading...</div>
                </div>
            </div>
            
            <div class="subsection">
                <div class="subsection-title">Installed Submodules</div>
                <div id="installed-submodules" class="repo-list">
                    <div class="empty-hint">No submodules installed</div>
                </div>
            </div>
        </div>
    </div>

    <div class="buttons">
        <button class="btn btn-primary" onclick="save()">💾 Save Configuration</button>
        <button class="btn btn-secondary" onclick="cancel()">Cancel</button>
        <button id="reset-btn" class="btn reset-btn-right" style="display: none;" onclick="resetToSTM32F103Defaults()">🔄 Reset to STM32F103 Defaults</button>
    </div>
    <p id="reset-hint" class="reset-hint-bottom" style="display: none;">Reset paths to default STM32F103 (Blue Pill) project structure</p>

    <script>${generateClientScript(config)}</script>
</body>
</html>`;
    }
}
