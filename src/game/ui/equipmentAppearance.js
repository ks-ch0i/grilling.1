import { equipmentAppearanceTextureKey } from './equipmentAppearanceAssets.js';

const LAYER_ORDER = Object.freeze(['horse','armor','boots','gloves','helmet','spear']);
const TOWN_KNIGHT_SLOTS = Object.freeze(['armor','boots','gloves','helmet','spear']);

export function getEquipmentTextureKey(slot, rarity) {
  return equipmentAppearanceTextureKey(slot, rarity);
}

export class EquipmentAppearance {
  constructor(scene, parent, equipment, {
    scale,
    actionScale = scale,
    origin = [0.5, 244 / 256],
    slots = LAYER_ORDER,
    initialFrame = 0,
  } = {}) {
    if (!scene?.add || !parent || parent.type !== 'Container' || typeof parent.add !== 'function') {
      throw new TypeError('Equipment appearance requires a Phaser container parent.');
    }
    if (!Number.isFinite(scale) || scale <= 0) throw new TypeError('Equipment scale must be a positive finite number.');
    if (!Number.isFinite(actionScale) || actionScale <= 0) throw new TypeError('Action scale must be a positive finite number.');
    this.assertFrame(initialFrame);
    if (!Array.isArray(slots) || slots.some((slot) => !LAYER_ORDER.includes(slot)) || new Set(slots).size !== slots.length) {
      throw new RangeError('Equipment slots must be a unique list of supported slots.');
    }

    this.scene = scene;
    this.parent = parent;
    this.scale = scale;
    this.actionScale = actionScale;
    this.direction = -1;
    this.container = scene.add.container(0, 0);
    parent.add(this.container);
    this.frameIndex = initialFrame;
    this.visible = true;
    this.destroyed = false;
    const orderedSlots = LAYER_ORDER.filter((slot) => slots.includes(slot));
    this.layers = orderedSlots.map((slot) => {
      const item = equipment?.[slot] ?? null;
      const key = item ? getEquipmentTextureKey(slot, item.rarity) : getEquipmentTextureKey(slot, 'common');
      const image = scene.add.image(0, 0, key, initialFrame)
        .setOrigin(...origin)
        .setVisible(Boolean(item));
      this.container.add(image);
      return { slot, image, equipped:Boolean(item) };
    });
    this.setEquipment(equipment);
    this.setFrame(initialFrame);
  }

  assertFrame(frameIndex) {
    if (!Number.isInteger(frameIndex)) throw new TypeError('Equipment frame must be an integer.');
    if (frameIndex < 0 || frameIndex > 10) throw new RangeError('Equipment frame must be between 0 and 10.');
  }

  setEquipment(equipment) {
    if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) {
      throw new TypeError('Equipment must be a slot record.');
    }
    const updates = this.layers.map((layer) => {
      const item = equipment[layer.slot] ?? null;
      return { layer, item, key:item ? getEquipmentTextureKey(layer.slot, item.rarity) : null };
    });
    for (const { layer, item, key } of updates) {
      layer.equipped = Boolean(item);
      if (item && layer.image.texture?.key !== key && layer.image.key !== key) {
        layer.image.setTexture(key);
        layer.image.setFrame(this.frameIndex);
      }
      layer.image.setVisible(this.visible && layer.equipped);
    }
    return this;
  }

  setFrame(frameIndex) {
    this.assertFrame(frameIndex);
    this.frameIndex = frameIndex;
    for (const { image } of this.layers) image.setFrame(frameIndex);
    this.updateScale();
    return this;
  }

  setFacing(direction) {
    if (direction !== -1 && direction !== 1) return this;
    this.direction = direction;
    this.updateScale();
    return this;
  }

  updateScale() {
    const scale = this.frameIndex >= 4 && this.frameIndex <= 9 ? this.actionScale : this.scale;
    this.container.setScale(this.direction > 0 ? -scale : scale, scale);
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    for (const { image, equipped } of this.layers) image.setVisible(this.visible && equipped);
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const { image } of this.layers) image.destroy();
    this.layers.length = 0;
    this.container.destroy();
  }
}

export function renderTownEquipmentPreview(scene, equipment) {
  const horseContainer = scene.add.container(556, 118);
  const horseAppearance = new EquipmentAppearance(scene, horseContainer, equipment, {
    scale:64 / 256,
    origin:[0.5, 0.5],
    slots:['horse'],
    initialFrame:10,
  });

  const knightContainer = scene.add.container(628, 118);
  const knightAppearance = new EquipmentAppearance(scene, knightContainer, equipment, {
    scale:64 / 256,
    origin:[0.5, 0.5],
    slots:TOWN_KNIGHT_SLOTS,
    initialFrame:10,
  });
  return { horseAppearance, knightAppearance };
}
