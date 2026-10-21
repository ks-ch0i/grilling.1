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
 gearUpgrade:freezeRecord({
  ordinaryIncrease:freezeRecord({min:0.01,max:0.05}), greatSuccessChance:0.05,
  specialIncrease:freezeRecord({
   critChance:freezeRecord({min:0.001,max:0.01}), critMultiplier:freezeRecord({min:0.01,max:0.1}),
   moveSpeedPercent:freezeRecord({min:0.01,max:0.05}), bonusDamage:freezeRecord({min:0.01,max:0.05}),
   damageReduction:freezeRecord({min:0.001,max:0.01}), lifeSteal:freezeRecord({min:0.001,max:0.01}),
   thorns:freezeRecord({min:0.01,max:0.03}),
  }),
 }),
 normalEnemyCount:10, normalDropChance:0.2, bossDropCount:1, knockbackPixels:96,
 enemyBaseStats:freezeRecord({maxHp:60,attack:12,defense:10}), xpRewards:freezeRecord({normalEnemy:10,stageClear:100,boss:200}),
 contactInvulnerabilityMs:0, enemyStageGrowth:0.2, chapterGrowth:0.8,
 bossMultipliers:freezeRecord({maxHp:5,attack:2,defense:2}), healAfterStage:0.5, replayXpMultiplier:0.3,
 gearRarityMultipliers:freezeRecord({common:1,uncommon:1.5,rare:2,unique:3,legendary:5}),
 stageDropWeights:freezeRecord({first:stageOneDropWeights,tenth:stageTenDropWeights}),
 equipmentTemplates:freezeRecord({
  helmet:freezeRecord({defense:4}), armor:freezeRecord({defense:8,maxHp:20}),
  gloves:freezeRecord({critChance:0.03,critMultiplier:0.15}), boots:freezeRecord({critChance:0.02,critMultiplier:0.25}),
  spear:freezeRecord({attack:8}), horse:freezeRecord({moveSpeedPercent:0.2}),
 }),
 effectValues:freezeRecord({bonusDamage:freezeRecord({common:0.05,uncommon:0.08,rare:0.12,unique:0.18,legendary:0.25}),lifeSteal:freezeRecord({common:0,uncommon:0,rare:0.01,unique:0.03,legendary:0.05}),damageReduction:freezeRecord({common:0.02,uncommon:0.03,rare:0.05,unique:0.08,legendary:0.12}),thorns:freezeRecord({common:0.03,uncommon:0.05,rare:0.08,unique:0.12,legendary:0.18})}), gearRollRange:freezeRecord({min:0.75,max:1.25}),
});
export function getStageDropWeights(stage) {
 const clampedStage=Math.min(10,Math.max(1,stage));
 const progress=(clampedStage-1)/9;
 return stageOneDropWeights.map((weight,index)=>weight+(stageTenDropWeights[index]-weight)*progress);
}

export function getStageEnemyStats(chapter, stage, isBoss = false) {
 if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(stage) || stage < 1 || stage > 10) {
  throw new RangeError('chapter must be positive and stage must be an integer from 1 to 10.');
 }
 const growth=(1+BALANCE.enemyStageGrowth*(stage-1))*(1+BALANCE.chapterGrowth*(chapter-1));
 const normal={
  maxHp:Math.ceil(BALANCE.enemyBaseStats.maxHp*growth),
  attack:Math.ceil(BALANCE.enemyBaseStats.attack*growth),
  defense:Math.ceil(BALANCE.enemyBaseStats.defense*growth),
 };
 if(!isBoss)return {...normal,hp:normal.maxHp,currentHp:normal.maxHp,isBoss:false};
 const maxHp=normal.maxHp*BALANCE.bossMultipliers.maxHp;
 return {
  maxHp,
  hp:maxHp,
  currentHp:maxHp,
  attack:Math.ceil(normal.attack*BALANCE.bossMultipliers.attack),
  defense:Math.ceil(normal.defense*BALANCE.bossMultipliers.defense),
  isBoss:true,
 };
}
