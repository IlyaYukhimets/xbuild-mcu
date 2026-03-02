# Xbuild MCU

<p align="center">
  <img src="./resources/xmake-icon.png" alt="Xbuild MCU Logo" width="128">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=bobr.xbuild-mcu">
    <img src="https://img.shields.io/visual-studio-marketplace/v/bobr.xbuild-mcu?label=VS%20Marketplace&logo=visual-studio-code" alt="Marketplace Version">
  </a>
  <a href="https://github.com/IlyaYukhimets/xbuild-mcu/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/IlyaYukhimets/xbuild-mcu" alt="License">
  </a>
</p>

**Xbuild MCU** — это расширение для VSCode, превращающее его в IDE для разработки на STM32. Это современная, легковесная альтернатива STM32CubeIDE, основанная на системе сборки [Xmake](https://xmake.io/).

Расширение автоматизирует рутину: создает структуру проекта, импортирует код из CubeMX, настраивает сборку через GCC и прошивку через JLink, а также интегрирует отладку.

## ✨ Возможности

- 🚀 **Быстрый старт**: Генерация структуры проекта из готовых шаблонов.
- ⚙️ **Интеграция с CubeMX**: Импорт системных файлов и конфигурации.
- 🔧 **GUI Конфигурация**: Редактирование `xmake.lua` через удобный интерфейс VSCode.
- 🎯 **Пресеты MCU**: Готовые настройки для STM32F1, F4, H7 и других серий.
- ⚡ **Сборка и Прошивка**: Команды Build/Rebuild/Flash прямо в VSCode.
- 🐞 **Отладка**: Автоматическая генерация `launch.json` для Cortex-Debug.
- 📚 **Doxygen**: Генерация документации одной командой.

## 📋 Требования

Перед началом работы убедитесь, что установлены следующие инструменты:

| Инструмент | Описание |
|------------|----------|
| [**Xmake**](https://xmake.io/#/guide/installation) | Система сборки (обязательно). |
| [**ARM GCC Toolchain**](https://developer.arm.com/tools-and-software/open-source-software/developer-tools/gnu-toolchain/gnu-rm) | Компилятор (arm-none-eabi-gcc). Можно использовать из состава STM32CubeIDE. |
| [**JLink**](https://www.segger.com/downloads/jlink/) | SEGGER JLink для прошивки и отладки (опционально, если используете ST-Link). |
| [**Doxygen**](https://www.doxygen.nl/download.html) | Для генерации документации (опционально). |

## 📥 Установка

1. Откройте VSCode.
2. Перейдите в раздел Extensions (`Ctrl+Shift+X`).
3. Введите в поиске **Xbuild MCU**.
4. Нажмите **Install**.

## 🏃 Быстрый старт

### 1. Создание проекта
Откройте пустую папку в VSCode.

Открыть расширение -> `Project Configuration` -> `Create xmake.lua`

Если добавлены шаблоны, то используйте команду палитры (`Ctrl+Shift+P`) -> `Xbuild: Apply Template` либо интерфейс расширения, чтобы создать структуру папок.

### 2. Импорт из CubeMX (если есть проект)
Если вы сгенерировали код в STM32CubeMX:
1. Выполните команду `Xbuild: Import from CubeMX`.
2. Укажите путь к папке проекта CubeMX.
3. Расширение скопирует startup, linker script и драйверы.

### 3. Настройка проекта
В `Project Configuration` настройте:
- **MCU Series & Core**: Например, `STM32F103xB` и `cortex-m3`.
- **Paths**: Пути к JLink и ARM GCC.
- **Sources/Includes**: Управляйте файлами проекта через список.

Нажмите **Save Configuration**. Это обновит `xmake.lua`.

### 4. Сборка и прошивка
- Выберите режим сборки (настройки оптимизации можно найти в `Project Configuration`).
- Нажмите `Build` для сборки в выбранном режиме, либо вызовите `Xbuild: Build Debug` / `Xmake: Build Release`.
- Нажмите `Flash via JLink` (`Ctrl+Alt+F`) для прошивки.

## 📁 Структура проекта

Расширение использует (и рекомендует) следующую структуру:

```bash
my_project/
├── xmake.lua           # Конфигурация сборки (управляется через GUI)
├── app/                # Ваш прикладной код
├── board/              # Инициализация платы и периферии
├── Core/               # Startup файлы и системный код (из CubeMX)
│   ├── startup_*.s
│   ├── Inc/
│   │   └── stm32_assert.h
│   └── Src/
│       ├── syscalls.c
│       └── system_*.c
├── Drivers/            # HAL/CMSIS библиотеки
├── *.ld                # Linker script
├── .vscode/
│   └── launch.json     # (Автогенерация) Настройки отладки
└── templates/          # (Опционально) Шаблоны для разных MCU
```

## ⚙️ Конфигурация (GUI)

Расширение предоставляет графический интерфейс для редактирования `xmake.lua` без необходимости вручную править Lua-код.

### Основные поля:

| Поле | Описание |
|------|----------|
| **Project Name** | Имя проекта (используется для имени бинарника). |
| **MCU Series** | Макрос серии, например `STM32F103xB`. |
| **MCU Core** | Архитектура ядра: `cortex-m3`, `cortex-m4`, `cortex-m7`. |
| **MCU Device** | Имя устройства для JLink (например, `STM32F103C8`). |
| **Linker Script** | Путь к .ld файлу. |
| **SVD File** | Файл описания регистров для отладки (опционально). |
| **JLink Path** | Путь к JLink.exe |
| **STM32 SDK** | Путь к ARM GCC |

### Пресеты MCU

Расширение содержит готовые пресеты:

| Пресет | MCU | Ядро |
|--------|-----|------|
| STM32F103 | STM32F103xB | cortex-m3 |
| STM32F401 | STM32F401xC | cortex-m4 |
| STM32F407 | STM32F407xx | cortex-m4 |
| STM32F411 | STM32F411xE | cortex-m4 |
| STM32F429 | STM32F429xx | cortex-m4 |
| STM32H743 | STM32H743xx | cortex-m7 |
| STM32L476 | STM32L476xx | cortex-m4 |

### Сброс к стандартным путям

Кнопка **Reset to STM32F103 Defaults** устанавливает типичные пути для проекта Blue Pill:

```bash
Defines:     USE_FULL_LL_DRIVER
Includes:    app, board, board/peripherals, Core/Inc, Drivers/...
Sources:     app/*.cpp, board/*.cpp, Core/Src/*.c, Drivers/...
```

## ⚙️ Настройка шаблонов (Templates)

Расширение позволяет управлять шаблонами проектов через Git-сабмодули. Вы можете подключить свой репозиторий с шаблонами кода.

### 1. Глобальные настройки
Откройте настройки пользователя: `Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)".

Добавьте секцию `xmake.submoduleRepos`, указав **свои** репозитории:

```json
{
    "xmake.submoduleRepos": [
        {
            "name": "templates",
            "url": "https://github.com/USERNAME/stm32-templates.git",
            "description": "My MCU Project Templates",
            "path": "templates"
        },
        {
            "name": "mcu_libs",
            "url": "https://github.com/USERNAME/stm32-libs.git",
            "description": "My MCU Libraries Collection"
        }
    ]
}
```

### 2. Проектные настройки
Если вы хотите переопределить список сабмодулей для конкретного проекта, создайте файл `.vscode/settings.json` в папке проекта с аналогичной структурой.

## 🛠 Команды и задачи

Все команды доступны через палитру (`Ctrl+Shift+P`) или боковую панель:

| Команда | Описание |
|---------|----------|
| `Xbuild: Build` | Сборка проекта (Debug/Release). |
| `Xbuild: Flash` | Прошивка через JLink. |
| `Xbuild: Clean` | Очистка артефактов сборки. |
| `Xbuild: Apply Template` | Применить структуру папок из шаблона. |
| `Xbuild: Import from CubeMX` | Импорт файлов из проекта CubeMX. |
| `Xbuild: Generate Doxygen` | Создание документации. |

## 🐞 Отладка

Расширение автоматически генерирует `.vscode/launch.json` для работы с плагином **Cortex-Debug**.
Для отладки:
1. Установите расширение [Cortex-Debug](https://marketplace.visualstudio.com/items?itemName=marus25.cortex-debug).
2. Соберите проект.
3. Перейдите во вкладку "Run and Debug" и выберите конфигурацию "JLink Debug".

## Создание своих шаблонов (на примере STM32F103)

Структура репозитория шаблонов:

```bash
stm32-templates/
├── stm32f1/
│   ├── template.lua          # Метаданные
│   ├── app/
│   │   ├── app_main.cpp
│   │   └── app_main.hpp
│   └── board/
│       ├── board.cpp
│       ├── board.hpp
│       ├── board_config.hpp
│       └── pin_config.hpp
├── stm32f4/
│   └── ...
└── README.md
```

**template.lua**:

```lua
return {
    name = "stm32f1",
    description = "STM32F1xx BluePill template",
    dirs = {
        "app",
        "board/peripherals",
        "Core/Inc",
        "Core/Src",
        "Drivers",
        ".vscode"
    },
    variables = {
        MCU_SERIES = "STM32F103xB",
        MCU_CORE = "cortex-m3",
        MCU_DEVICE = "STM32F103C8"
    }
}
```

## 🏗 Разработка и сборка расширения

Если вы хотите модифицировать расширение или собрать его из исходников:

**Требования для разработки:**
- `Node.js` JavaScript runtime (v16+)
- `npm` Package manager
- `vsce` VSCode Extension Manager (`npm install -g @vscode/vsce`)

**Сборка:**
```bash
# Установка зависимостей
npm install

# Компиляция (режим разработки)
npm run compile

# Упаковка в .vsix
vsce package
```

## 📜 Лицензия

Этот проект распространяется под лицензией **MIT**. См. файл [LICENSE](LICENSE) для подробностей.

В проекте используется система сборки **Xmake**, распространяемая под лицензией Apache 2.0.
