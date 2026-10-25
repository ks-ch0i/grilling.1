# Decisions: Enemy Chase and Animated Enemy Sprites

- Date: 2026-10-25
- Status: Confirmed

## D01. Enemy roster
- **Chosen**: Three normal enemy types and one distinct boss: goblin spearman, armored boar, horned brute, and a large armored warlord.
- **Rationale**: This adds visual variety to ordinary encounters while giving the boss a more imposing and weighty silhouette.

## D02. Enemy animation states
- **Chosen**: Create walk, hit, and defeat animations for all three normal enemies and the boss.
- **Rationale**: Enemy sprites should communicate their movement, damage, and defeat during combat.

## D05. Player run cycle
- **Chosen**: Use four horse-and-cape walking poses under one shared static rider image. The knight's helmet, chest, shoulders, arms, and lance stay in the same calm riding pose throughout walking; horse legs and cape continue moving.
- **Rationale**: After approving the simple designs, the user specifically asked to fix the mounted knight's upper body because the alternating shoulders looked like dancing. This exception supersedes the earlier rider counter-rotation direction. Enemy whole-body walking stays as approved.

## D06. Enemy walk cycles
- **Chosen**: Use four complete whole-body drawings per character. Alternate near/far leg lead while the chest and shoulders turn against the pelvis, exposing different front/back body planes. Use simple outlined cel-shaded designs for all three normal enemies and the boss; keep the boss broad, armored, and imposing.
- **Rationale**: The user rejected the realistic cutout rigs as a paper-puppet result. They then approved the new goblin whole-body direction and explicitly liked the new character designs. Preserve those designs while refining playback.

## D07. Walk timing and sprite baseline
- **Chosen**: Advance gait phase by actual horizontal distance divided by stride length. Pack every full-body pose against a common sole baseline, retain constant scale within each sheet, and never accumulate vertical offsets. Share WholeBodyWalk between ordinary/ranked combat and the local preview. Stops, pauses, and teleports do not add walking steps.
- **Rationale**: The cycle follows horizontal travel and actors cannot drift upward. This is a presentation change; the existing v3 combat simulator is unchanged.

## D08. Verification and authoring
- **Chosen**: Keep `/walk-preview.html` with character selection, pause, slow motion, direction reversal, individual poses, hit recovery, and defeat playback. `/animation-preview.html` redirects to it. Save built-in image-generation prompts in `docs/art/walk-prompts.json`; pack complete figures with `scripts/pack-walk-cycle.ps1`.
- **Validation**: Decode all ten packed RGBA PNGs to check frame bounds and sole baselines. Check distance-driven timing across render rates and paused/stopped/teleported movement. Inspect ordinary/ranked BattleScene movement, direction changes, and action recovery in-browser.
- **Result (2026-10-26)**: Client tests 203/203, API tests 148/148, and production build passed. Browser checks covered all four walk poses, hit recovery and defeat completion for all five characters, plus ordinary/ranked battle movement with actor roots remaining at Y=560. Refreshed the stale local API game-rules package to v3 and adjusted incomplete-run test fixtures for chasing enemies.
- **Final knight correction (2026-10-26)**: Client tests 204/204 and production build passed. Browser battle checks confirmed four horse poses share one unchanged rider pose, hit recovery restores the composed rider/mount, and direction changes preserve the floor baseline. Superseded unreferenced image variants were retained locally under the ignored `node_modules/.cache/superseded-character-art/` archive.

## D03. Enemy movement
- **Chosen**: Enemies move toward the player in both ordinary and ranked stages.
- **Rationale**: The existing stationary enemies should become active opponents; applying the same behavior in both modes keeps combat consistent.

## D04. Ranked replay compatibility
- **Chosen**: Increase the ranked stage simulator version and expire active tickets issued under the previous version.
- **Rationale**: Server replay must use the same deterministic enemy movement as the client. The user chose to let existing 30-minute v2 tickets expire rather than retain a second simulator implementation.
