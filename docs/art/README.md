# Character animation assets

The accepted design uses simple outlined, cel-shaded whole-body drawings. The user approved the torso counter-rotation and forward/back weight transfer in the goblin preview, then approved the designs of all five characters. Frame count is a means of achieving that motion, not a requirement to increase.

`public/assets/walk/` contains four walk poses per character, two hit and two defeat poses per enemy, and two contact, two hit, and two defeat poses for the mounted knight. Every packed frame is 256 × 256 with its sole baseline at Y=244. The accompanying JSON records the visible standing height used to keep each character at the intended display scale.

`WholeBodyWalk.js` advances the walk by actual distance traveled. Both battle modes and `/walk-preview.html` use it. Action sprites use the same designs and baseline; existing combat and replay rules retain simulator version 3.

The mounted knight is an exception to torso counter-rotation: the user requested a steady upper body. `knight.png` contains the four horse-and-cape poses, while `knight-rider.png` is one static seated rider layered above them. The walking phase never changes the rider's pose or rotation. Attack, hit, and defeat continue using the action sheet. Authoring prompts for this correction are in `steady-knight-prompts.json`. Pack the mount sheet with `-IncludeDetachedParts` to retain its separate cape pixels.

Generate or edit the full sprite sheets with the built-in image-generation tool. Exact prompts are in `walk-prompts.json`. Pack a generated sheet on Windows with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/pack-walk-cycle.ps1 -SourcePath path/to/sheet.png -Name goblin -Rows 2 -AnchorX 0.55
```

The packer extracts connected complete figures instead of cutting blindly at cell boundaries, retains one scale across a sheet, and aligns every pose to the same ground line. Use three rows for `knight-actions`. The regression tests check the packed images for clipping and vertical drift.
