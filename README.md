# Flame3D

Flame3D is a browser-based 3D FPS level editor built with Three.js. It combines a block placement workflow, object properties editing, lighting controls, grid tools, player game rules, conditional triggers, save/load support, and an in-editor playtest mode.

## Table Of Contents

1. Overview
2. Files
3. Running Flame3D
4. Main Menu
5. Top Bar
6. Sidebar Menus
7. Block Types
8. Object Properties
9. Editing Controls
10. Playtest Controls
11. Player Systems
12. Control Systems
13. Lighting And Quality
14. Saving And Loading
15. Runtime Mode
16. Tips And Workflow
17. Troubleshooting
18. Current Scope

## Overview

Flame3D lets you:

- Create block-based FPS levels in a live 3D viewport.
- Place walls, floors, targets, lights, spawn points, and control blocks.
- Select, move, rotate, scale, group, and ungroup objects.
- Edit per-object properties such as color, solidity, groups, label, light emission, target health, switch behavior, and control rules/functions.
- Configure sun lighting, day cycle, grid visuals, render quality, and player movement rules.
- Build conditional player logic such as health checks, position checks, and touching a named object or group.
- Play the level immediately in a first-person test mode.
- Save projects to browser storage or export/import JSON files.

## Files

- `index.html`: UI layout, styling, and all sidebar/topbar structure.
- `main.js`: Editor logic, rendering, object systems, saving/loading, playtest logic, controls/switches, and UI wiring.
- `README.md`: Project documentation.

## Running Flame3D

Because Flame3D uses ES modules and remote imports, run it through a local web server instead of opening the file directly.

Example:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Main Menu

The main menu appears when the app starts or when you return from the editor.

### New Project

- Starts a fresh scene.
- Clears placed objects.
- Resets undo and redo history.

### Import JSON

- Loads a previously exported level file.
- Restores objects, lighting settings, game rules, grid settings, and conditional triggers.

### Saved Projects

- Shows projects saved in local browser storage.
- Lets you reopen a project directly.
- Lets you delete saved projects.

## Top Bar

The top bar is the primary editing command strip.

### Menu Selector

- `Block`: Object placement and transform workflow.
- `Light`: Light and sun settings.
- `Grid`: Grid display and render distance settings.
- `Player`: Player movement, health, fall damage, spawn protection, and conditional triggers.

### Block Panel

Visible when the top menu is set to `Block`.

#### Mode Buttons

- `Place`: Place the currently selected block type.
- `Select`: Select and transform existing objects.
- `Delete`: Delete objects by clicking them.

#### Gizmo Buttons

- `Move`: Translation gizmo.
- `Rot`: Rotation gizmo.
- `Scale`: Scale gizmo.

#### Scale Side Controls

Available while scaling.

- `X`: Choose `+X` or `-X` growth direction.
- `Y`: Choose `+Y` or `-Y` growth direction.
- `Z`: Choose `+Z` or `-Z` growth direction.

#### Group Controls

- `Select All`: Select all placeable scene objects at once.
- `Group`: Create an editor group from the current selection.
- `Ungroup`: Remove editor grouping.

#### Snap

- Sets translation snap size.
- Also drives surface and ground placement snapping.

### Undo And Redo

- `Undo`: Reverse the latest editor action.
- `Redo`: Reapply the latest undone action.

### Scene Commands

- `Clear`: Delete all placed objects.
- `Save`: Save the current project to browser storage.
- `Export`: Download level JSON.
- `Game HTML`: Export a standalone, self-running game HTML file from the current level.
- `Loader HTML`: Export a runtime HTML launcher that can import and store multiple game JSON files, then play any of them without editor tools.
- `Load`: Load a JSON file.
- `Play`: Enter playtest mode.
- `Stop`: Exit playtest mode.
- `Menu`: Return to the main menu.

## Sidebar Menus

- The sidebar can be resized by dragging its edge.
- The sidebar can be collapsed and expanded.

## Block Menu

The Block menu is a categorized library of placeable objects.

- `Objects / Blocks`: `Wall`, `Floor`
- `Lighting`: `Light`
- `Gameplay`: `Target`, `Spawn`
- `Control`: `Control`

The selected block type is used by Place mode.

## Light Menu

The Light menu contains all lighting-related controls.

### Default Light Block

- `Brightness`: Sets the default intensity for newly placed light blocks.

### Sun

- `Time`: Time of day.
- `North`: Rotates the sun’s north alignment.
- `Intensity`: Sun brightness.
- `Haze`: Atmospheric turbidity.
- `Shadow`: Sun shadow range.
- `Day (s)`: Full day/night cycle duration during playtest.
- `Cycle`: Enables or disables automatic day progression during playtest.

### Quality

- `Shadows`: Global shadow quality preset.
- `Light Dist`: Distance at which point lights stay active.

## Grid Menu

The Grid menu now controls grid visuals and world visibility distance.

### Grid Range

- `Range`: Number of visible grid chunks around the camera.

### Floor Fill

- `Color`: Fill color under the grid.
- `Enabled`: Show or hide the fill plane.

### Quality

- `Render Dist`: Maximum object visibility distance.

## Player Menu

The Player menu contains playtest rules and conditional player logic.

### Movement

- `Jump`: Jump force.
- `Gravity`: Downward acceleration.
- `Height`: Player height.
- `Sprint`: Sprint speed.

### Health

- `Max HP`: Maximum player health.

### Fall Damage

- `Enabled`: Toggle fall damage.
- `Min Height`: Minimum fall height before damage starts.
- `Vel. Mult.`: Fall damage multiplier.

### Spawn Protection

- `Timer (s)`: Protection duration after spawn.
- `Conditions`: What the protection blocks.
	- `All Damage`
	- `Fall Only`
	- `Until Landed`
	- `None`

### Conditional Triggers

These are player-side logic rules evaluated during playtest.

Each trigger includes:

- `Priority`: Higher runs first.
- `Mode`: `IF`, `WHEN`, or `WHILE`.
- Condition selector.
- Action target.
- Action math.
- Optional else branch.

Supported condition sources:

- `Health`
- `Touching`
- `Pos Y`
- `Pos X`
- `Pos Z`
- `Grounded`
- `Landed`

### Touching Condition

The `Touching` condition supports:

- `group`: Match against block group names.
- `name`: Match against block labels.

The condition represents the player touching the matched object(s), and appears in the UI as `Touching Player`.

Objects can belong to multiple groups. A group match passes if any assigned group matches the condition value.

When `group` is selected, the input shows existing group suggestions while still allowing a new group value to be typed manually.

## Block Types

## Wall

- Tall rectangular solid block.
- Solid by default.
- Good for structure and collision.

## Floor

- Flat rectangular solid block.
- Solid by default.
- Good for walkable surfaces and platforms.

## Target

- Spherical target block.
- Supports target health.
- Can be shot during playtest.

## Light

- Small visible point-light marker.
- Carries a real point light.
- Hidden visually during playtest while the light remains active.

## Spawn

- Defines player spawn and respawn location.
- Supports `Groups` assignment.
- First available spawn block is used for playtest start and death respawn.

## Control

- A visible editor block that becomes hidden during playtest.
- Uses overlap detection with the player.
- Can apply control rules when entered.
- Can run named functions that move objects or change their lighting.
- Supports `Groups` assignment.

## Object Properties

The Properties panel appears when an object is selected.

### Common Properties

- `Type`
- `Name`: Label used by name-based touching conditions.
- `Pos`
- `Rot°`
- `Scale`
- `Group` info for editor groups when grouped.
- `Groups`: Comma-separated membership list for gameplay grouping.

### Surface Properties

Available on walls and floors.

- `Color`

### Solid Toggle

Available on placeable solid-capable objects.

- `Solid`: Controls whether the player collides with the object.

### Groups Property

Available on all placeable objects.

- `Groups`: Suggests existing groups and accepts multiple values.
- Enter multiple groups as a comma-separated list (example: `default, enemy, moving`).

### Traction Property

Available on solid-capable objects.

- `Traction`: When enabled, a grounded player standing on the object is carried along the object movement on `X` and `Z` during playtest.

### Target Property

Available on targets.

- `Max HP`: `0` means invincible.

### Switch Property

Available on visible object/block types.

- `Switch`: Makes the selected object shootable during playtest.
- `Var`: Chooses which runtime value gates the switch.
- `Range`: Inclusive min/max range that must be met before the switch fires its functions.
- `Mode`: `One Shot` stops after function completion, `Repeat` allows repeated runs.

### Light Properties

Available on light-emitting objects.

- `Bright`: Light intensity.
- `Aura`: Light distance.

### Emit Property

Available on non-light blocks.

- `Emit`: Adds or removes a point light from the selected object.

### Control Rules And Functions

Available on control blocks, plus any object that has `Switch` enabled.

Control blocks can still add or remove player/game-rule overrides that fire on enter.

Functions support:

- Named function IDs such as `1`, `2`, or `raiseLift`.
- `IF` checks against another function name before the command runs.
- Targeting by `group` or `name`.
- `move` commands with `From XYZ` and `To XYZ`, both relative to the target object's original playtest-start position, plus animation style and duration.
- Move coordinates are relative to the target object's playtest-start position, not world origin.
- `light` commands that can `toggle`, `enable`, `disable`, set `intensity`, or set `distance` on target objects.
- `Copy` so you can duplicate and tweak existing functions quickly.

Supported control rule targets:

- `health`
- `jumpHeight`
- `gravity`
- `height`
- `sprintSpeed`
- `maxHealth`
- `fallDamage`
- `fallDamageMinHeight`
- `fallDamageMultiplier`

## Editing Controls

## Mouse

- Click in `Place` mode: Place the selected block.
- Click in `Select` mode: Select one object.
- `Shift` + click in `Select` mode: Multi-select.
- Click in `Delete` mode: Delete the clicked object.
- Drag with transform gizmo: Move, rotate, or scale.

## Keyboard In Editor

- `1`: Move gizmo.
- `2`: Rotate gizmo.
- `3`: Scale gizmo.
- `Ctrl+Z` or `Cmd+Z`: Undo.
- `Ctrl+Y` or `Cmd+Y`: Redo.
- `Ctrl+G` or `Cmd+G`: Group selected objects.
- `Ctrl+Shift+G` or `Cmd+Shift+G`: Ungroup selected objects.
- `Ctrl+A` or `Cmd+A`: Select all placeable objects.
- `Delete` or `Backspace`: Delete selected objects.
- `Tab` in Place mode: Sample hovered object scale for cloning.
- `P`: Start playtest.
- `Escape`: Stop playtest.

### Free-Fly Editor Camera

- `W A S D`: Horizontal movement.
- `Space` or `E`: Move upward.
- `ShiftLeft` or `Q`: Move downward.

## Playtest Controls

- `W A S D` or arrow keys: Move.
- `R`: Sprint.
- `Space`: Jump.
- `V`: Toggle Dev View for normally hidden playtest blocks.
- With Dev View `OFF`, hidden playtest objects only hide their mesh display; lights and other gameplay systems still run.
- Left click: Lock pointer or shoot.
- `Escape`: Exit playtest (editor) or pause game (runtime).
- `P`: Pause or resume game in runtime mode.

## Player Systems

### Health

- Player starts with `Max HP`.
- Health updates live in the playtest HUD.
- If health reaches `0`, the player respawns.

### Respawn

- Respawn uses the current spawn block’s actual world position.
- If no spawn block exists, playtest falls back to the editor camera start position.

### Fall Damage

- Uses the configured minimum height and multiplier.
- Can be blocked by spawn protection depending on settings.

### Spawn Protection

- Timer-based protection can block all damage, only fall damage, or stay active until the first landing.

### Traction

- If the player is grounded on a moving, solid object with `Traction` enabled, the player is carried along the surface on `X` and `Z`.
- Carry uses previous-frame support checks to stay more stable when platforms move quickly.

## Control Systems

## Control Blocks

- Control blocks check player overlap using AABB overlap during playtest.
- On enter, they apply configured control rules.
- Controls can run multiple named functions across multiple target objects.
- Functions can move targets or change target lighting.
- Function dependencies let one function wait for another function to be met.

## Shootable Switches

- A switch-enabled object can be pressed by shooting it.
- The switch only fires if its selected runtime variable is inside the configured min/max range.
- When fired, it runs the same function list used by control blocks.

## Conditional Triggers

- These run continuously during playtest.
- They can change player values and game rule values.
- `IF`: Fires once when the condition becomes true.
- `WHEN`: Fires every frame while true.
- `WHILE`: Fires on a repeat interval while true.

## Lighting And Quality

### Sun And Sky

- The sun updates lighting, sky appearance, and shadow behavior.
- Time can be fixed or animated during playtest.

### Point Lights

- Dedicated light blocks create point lights.
- Other blocks can emit lights through properties.
- Point lights are distance-culled using `Light Dist`.

### Quality Settings

- `Render Dist`: How far blocks stay visible.
- `Shadows`: Shadow quality preset.
- `Light Dist`: Distance at which point lights render.

## Saving And Loading

### Save Project

- Stores the current project in browser local storage.
- Includes settings and placed objects.

### Export JSON

- Downloads the current level as JSON.

### Export Game HTML

- Builds a self-running HTML file that includes the current level and runtime.
- Runs in play mode with editor tools disabled.
- Includes an in-game runtime settings panel for quality and day-cycle tuning.
- In-game `P` key or the `⏸ Pause` HUD button opens the pause menu.

### Export Loader HTML

- Builds a runtime-only HTML file with no editor tools.
- Provides a game library panel where multiple JSON files can be imported and kept in browser storage.
- Lets you launch any imported game from that library, similar to a lightweight game launcher flow.
- Each library entry stores the level name, object count, play duration, and last-played timestamp.
- Supports importing additional JSON files into the library at any time.
- Library data is stored using the key `flame3d_runtime_library_v1` in browser local storage.

### Load JSON

- Imports a previously saved JSON file.

### Saved Data Includes

- Scene objects
- Sun settings
- Game rules
- Grid fill settings
- Conditional triggers
- Object labels, groups, control rules/functions, switch settings, light values, and target health

## Runtime Mode

Runtime mode is active when a standalone game HTML is opened. It hides all editor UI and switches the app to a pure gameplay experience.

### Runtime Flags

The following globals control which runtime mode is active. They are set by the exported HTML before the main script runs.

| Flag | Type | Description |
|---|---|---|
| `__FLAME3D_RUNTIME_MODE__` | boolean | Activates runtime mode and hides editor UI. |
| `__FLAME3D_RUNTIME_LOADER__` | boolean | Shows the game library overlay instead of auto-starting. |
| `__FLAME3D_RUNTIME_AUTOSTART__` | boolean | Immediately starts the embedded level on load. |
| `__FLAME3D_EMBEDDED_LEVEL__` | object | Level JSON payload embedded in the page for autostart. |

### Runtime HUD

In runtime mode, a minimal HUD replaces editor controls.

- `⏸ Pause` button: Opens the pause menu.
- `⚙ Runtime` button: Toggles the runtime settings panel (quality and day cycle).
- `📚 Library` button (loader mode only): Returns to the game library overlay.

### Pause Menu

Opened with `P`, `Escape`, or the `⏸ Pause` HUD button. Pointer lock is released while the menu is shown.

- **Resume**: Closes the menu and re-locks the pointer.
- **Save Progress**: Saves the current position, health, hits, and optimizer state to the active library entry.
- **Save and Quit**: Saves progress and returns to the game library overlay.
- **Quit Without Saving**: Returns to the game library overlay without saving.
- **Restart Level**: Resets the level to its initial state and restarts without saving.
- **Settings**: Inline quality controls (shadow quality, render distance, light distance, auto-performance, auto-visual) available directly in the pause menu.

### Progress Snapshot

When saving progress, the following state is captured and can be restored on next launch:

- Player world position (X, Y, Z)
- Player look direction (yaw and pitch)
- Vertical velocity
- Current health
- Shot and target hit counts
- Adaptive optimizer state (current quality profile index)

Progress is stored per library entry and survives page refreshes as long as browser local storage is not cleared.

### Runtime Settings Panel

Accessible via the `⚙ Runtime` HUD button or inside the pause menu. Controls:

- **Shadow Quality**: Off, Low, Medium, High.
- **Render Distance**: Block visibility cutoff in world units.
- **Light Distance**: Point light render cutoff in world units.
- **Auto Performance**: When enabled, the adaptive optimizer can lower quality to maintain frame rate.
- **Auto Visual**: When enabled, the adaptive optimizer can raise quality when performance is good.

### Adaptive Performance Optimizer

When active, the optimizer monitors frame rate using an exponential moving average and automatically adjusts quality.

- Checks every 5 seconds (configurable via `RUNTIME_OPTIMIZER_CHECK_INTERVAL_MS`).
- After adjusting, waits at least 8 seconds before adjusting again (configurable via `RUNTIME_OPTIMIZER_COOLDOWN_MS`).
- Requires three consecutive low-FPS checks before stepping quality down (guards against brief spikes).
- Requires three consecutive high-FPS checks before stepping quality up.
- Quality profiles in order: **Performance**, **Balanced**, **Quality**, **Ultra**.
- Auto Performance and Auto Visual can be individually toggled.
- State is saved as part of the progress snapshot.

### Game Library

The game library overlay is shown in loader-mode exports and when returning from a level.

- Import JSON game files using the **Import JSON** button.
- Each entry shows the game name, object count, last-played date, and total play time.
- **Play** launches a fresh run; **Continue** restores saved progress if available.
- **Remove** deletes the entry and its progress from local storage.
- Library entries are stored in `flame3d_runtime_library_v1`.

## Tips And Workflow

1. Start by choosing a block type from the Block menu.
2. Build structure with walls and floors.
3. Add a spawn block before playtesting.
4. Use labels and groups early if you plan to use touching conditions.
5. Use control blocks for zone-based player changes.
6. Use conditional triggers for logic based on health, position, grounded state, or touching rules.
7. Save to browser storage often and export JSON snapshots when needed.

## Troubleshooting

### The App Does Not Load

- Make sure you are serving the files through a local web server.
- Do not open `index.html` directly as a file URL.

### Lights Or Shadows Look Wrong

- Check the Light menu `Shadows` setting.
- Increase `Light Dist` if point lights disappear too early.
- Adjust sun `Intensity`, `Haze`, and `Shadow` range.

### I Respawn In The Wrong Place

- Make sure a spawn block exists.
- The first spawn block in the scene is used.
- Respawn now uses the spawn block’s actual world placement.

### Touching Conditions Do Not Fire

- Confirm the target object has the expected `Group` or `Name`.
- For group checks, verify the group text matches the condition.
- For name checks, verify the label is set in the Properties panel.

## Current Scope

Flame3D currently focuses on:

- In-browser 3D level editing
- Immediate FPS playtesting
- Block/object property editing
- Trigger and conditional logic authoring
- Project save/load workflows
- Standalone game export with full runtime mode
- Game library and loader workflow for distributing multiple levels
- Adaptive performance optimization during runtime gameplay

Planned future work can build on this foundation, including animation systems.