const freezeRecord = (value) => Object.freeze(value);
export const GEAR_SLOT = freezeRecord({ HELMET:'helmet', ARMOR:'armor', GLOVES:'gloves', BOOTS:'boots', SPEAR:'spear', HORSE:'horse' });
export const RARITY = freezeRecord({ COMMON:'common', UNCOMMON:'uncommon', RARE:'rare', UNIQUE:'unique', LEGENDARY:'legendary' });
export const RARITY_COLOR = freezeRecord({ common:0x858b91, uncommon:0xf2f2f2, rare:0x4294ff, unique:0xb45cff, legendary:0xffcf45 });
export const STAT_KEYS = Object.freeze(['maxHp','attack','defense','critChance','critMultiplier','moveSpeedPercent']);
const stageOneDropWeights = Object.freeze([60,25,10,4,1]);
const stageTenDropWeights = Object.freeze([30,25,20,15,10]);
export const BALANCE = freezeRecord({
 canvas:freezeRecord({width:1280,height:720}), inventoryCapacity:20,
 basePlayer:freezeRecord({maxHp:100,attack:10,defense:5,critChance:0.05,critMultiplier:2,moveSpeed:200}),
 levelUp:freezeRecord({attack:2,defense:5,maxHp:10}), critChanceCap:1, gearMaxLevel:30,
 normalEnemyCount:10, normalDropChance:0.2, bossDropCount:1, knockbackPixels:96,
 contactInvulnerabilityMs:0, enemyStageGrowth:0.1, chapterGrowth:0.5,
 bossMultipliers:freezeRecord({maxHp:5,attack:2,defense:2}), healAfterStage:0.5, replayXpMultiplier:0.3,
 gearRarityMultipliers:freezeRecord({common:1,uncommon:1.5,rare:2,unique:3,legendary:5}),
 stageDropWeights:freezeRecord({first:stageOneDropWeights,tenth:stageTenDropWeights}),
 equipmentTemplates:freezeRecord({
  helmet:freezeRecord({defense:4}), armor:freezeRecord({defense:8,maxHp:20}),
  gloves:freezeRecord({critChance:0.03,critMultiplier:0.15}), boots:freezeRecord({critChance:0.02,critMultiplier:0.25}),
  spear:freezeRecord({attack:8}), horse:freezeRecord({moveSpeedPercent:0.2}),
 }),
 gearRollRange:freezeRecord({min:0.75,max:1.25}),
});
export function getStageDropWeights(stage) {
 const clampedStage=Math.min(10,Math.max(1,stage));
 const progress=(clampedStage-1)/9;
 return stageOneDropWeights.map((weight,index)=>weight+(stageTenDropWeights[index]-weight)*progress);
}
