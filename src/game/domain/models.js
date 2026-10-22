/**
 * @typedef {'helmet'|'armor'|'gloves'|'boots'|'spear'|'horse'} GearSlot
 * @typedef {'common'|'uncommon'|'rare'|'unique'|'legendary'} Rarity
 * @typedef {'maxHp'|'attack'|'defense'|'critChance'|'critMultiplier'|'moveSpeedPercent'} StatKey
 * @typedef {object} GearEffect
 * @property {string} id
 * @property {number} value
 * @typedef {object} GearItem
 * @property {string} id
 * @property {GearSlot} slot
 * @property {Rarity} rarity
 * @property {number} level
 * @property {Partial<Record<StatKey, number>>} stats
 * @property {GearEffect[]} effects
 * @typedef {object} PlayerBaseStats
 * @property {number} maxHp
 * @property {number} attack
 * @property {number} defense
 * @property {number} critChance
 * @property {number} critMultiplier
 * @property {number} moveSpeed
 * @typedef {object} PlayerState
 * @property {number} level
 * @property {number} xp Progress toward xpToNext, not lifetime XP.
 * @property {number} xpToNext
 * @property {number} pendingLevelUps
 * @property {number} currentHp
 * @property {PlayerBaseStats} baseStats
 * @property {number} availableStatPoints
 * @property {number} spentStatPoints
 * @property {number} statResetCount
 * @typedef {object} ProgressionState
 * @property {number} chapter
 * @property {number} currentStage
 * @property {number} unlockedChapter
 * @property {number} unlockedStage
 * @property {string[]} clearedStageIds Stage IDs use the chapter-stage format.
 * @typedef {object} GameState
 * @property {2} schemaVersion
 * @property {PlayerState} player
 * @property {Record<GearSlot, GearItem|null>} equipment
 * @property {GearItem[]} inventory
 * @property {number} materials
 * @property {number} gold
 * @property {ProgressionState} progression
 */
export {};
