import assert from 'node:assert/strict';
import test from 'node:test';
import { EquipmentAppearance } from '../src/game/ui/equipmentAppearance.js';
import { EQUIPMENT_APPEARANCE_ASSETS, equipmentAppearanceTextureKey } from '../src/game/ui/equipmentAppearanceAssets.js';

function scene() {
  return { add: {
    container() { return { type:'Container', children:[], add(o) { this.children.push(o); }, setScale(x,y) { this.xScale=x; this.yScale=y; }, destroy() {} }; },
    image(_x,_y,key,frame) { return { key, frame, visible:true, setOrigin() { return this; }, setVisible(v) { this.visible=v; return this; }, setTexture(k) { this.key=k; return this; }, setFrame(f) { this.frame=f; return this; }, destroy() {} }; },
  } };
}
const equipment = () => ({ horse:{rarity:'common'}, armor:{rarity:'common'}, boots:{rarity:'common'}, gloves:{rarity:'common'}, helmet:{rarity:'common'}, spear:{rarity:'common'} });

test('appearance manifest exposes distinct front and back atlases', () => {
  assert.equal(EQUIPMENT_APPEARANCE_ASSETS.length, 60);
  assert.equal(equipmentAppearanceTextureKey('helmet','rare'), 'gear-helmet-rare');
  assert.equal(equipmentAppearanceTextureKey('helmet','rare','front'), 'gear-helmet-rare-front');
  assert.throws(() => equipmentAppearanceTextureKey('helmet','rare','other'), RangeError);
});

test('slot fragments update together, and invalid rarity cannot partially change them', () => {
  const parent = { type:'Container', add() {} };
  const view = new EquipmentAppearance(scene(), parent, equipment(), { scale:1 });
  assert.equal(view.layers.length,12);
  view.setFrame(7).setEquipment({ ...equipment(), helmet:{rarity:'rare'} });
  assert.deepEqual(view.layers.filter(({slot}) => slot==='helmet').map(({image}) => [image.key,image.frame]), [['gear-helmet-rare',7],['gear-helmet-rare-front',7]]);
  const before = view.layers.map(({image}) => [image.key,image.frame,image.visible]);
  assert.throws(() => view.setEquipment({ ...equipment(), armor:{rarity:'rare'}, helmet:{rarity:'invalid'} }), RangeError);
  assert.deepEqual(view.layers.map(({image}) => [image.key,image.frame,image.visible]), before);
  view.setEquipment({ ...equipment(), helmet:null });
  assert.ok(view.layers.filter(({slot}) => slot==='helmet').every(({image}) => !image.visible));
});
