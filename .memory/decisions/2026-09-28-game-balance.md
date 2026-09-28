# Decisions: Game Balance Adjustment

- Date: 2026-09-28
- Status: Confirmed

## D01. Life-steal balance
- **Chosen**: Set life-steal effect values by rarity to common 0%, uncommon 0%, rare 1%, unique 3%, and legendary 5%.
- **Rationale**: Reduce the current healing strength while preserving rarity progression.
- **Implementation note**: Effects currently roll only on unique and legendary gear, so the live generated values will be 3% and 5%. Healing still follows the combat formula and is floored to whole HP.

## D02. Enemy progression
- **Chosen**: Increase enemy stats by 20% per stage and 80% per chapter, using the existing multiplicative growth structure: `(1 + 0.20 * (stage - 1)) * (1 + 0.80 * (chapter - 1))`.
- **Rationale**: Make enemies grow more strongly as stages and chapters progress.

## D03. Ordinary gear-stat upgrades
- **Chosen**: Keep the current upgrade behavior for max HP, attack, and defense: choose one stat, multiply it by a random 1% to 5%, then round upward to an integer.
- **Rationale**: The requested lower, fractional growth applies to special stats; ordinary integer stats retain their current behavior.

## D04. Special-stat upgrade scope and formulas
- **Chosen**: Use additive increases for all seven special stats and effects. Each ordinary upgrade rolls within the selected stat's range below. Percentage-point values are added directly to the stored percentage value.

| Special stat/effect | Ordinary upgrade increase | Existing cap behavior |
| --- | ---: | --- |
| Critical chance | +0.1 to 1 percentage point | Keep 100% cap |
| Critical multiplier | +0.01x to 0.1x | No new cap |
| Move-speed bonus | +1 to 5 percentage points | No new cap |
| Bonus damage | +1 to 5 percentage points | No new cap |
| Damage reduction | +0.1 to 1 percentage point | Keep 100% cap |
| Life steal | +0.1 to 1 percentage point | Healing remains capped by max HP through combat resolution |
| Thorns | +1 to 3 percentage points | No new cap |

- **Rationale**: Special stats have different scales and gameplay impact, so each receives its own additive range rather than multiplying its existing value.

## D05. Great-success upgrades
- **Chosen**: Each upgrade attempt has a 5% great-success chance. On great success, double the rolled increase for the option or options selected by that upgrade. Ordinary upgrades remain guaranteed.
- **Rationale**: Add a rare, noticeable outcome without changing the normal success flow.

## D06. Existing saves
- **Chosen**: Preserve existing saved equipment values. Apply the new balance to newly generated gear and upgrades made after the change; do not migrate or reset saved items.
- **Rationale**: Preserve player progress and prior investment.

## D07. Great-success feedback
- **Chosen**: Show a great-success message only; do not include the numeric increase in that message.
- **Rationale**: Make the rare result visible while keeping the feedback concise.
