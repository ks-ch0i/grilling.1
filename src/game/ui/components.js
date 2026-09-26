import Phaser from 'phaser';
import { RARITY_COLOR } from '../data/balance.js';

export function createButton(scene, { x, y, width, height, label, onClick, enabled = true }) {
  const container = scene.add.container(x, y);
  const background = scene.add.rectangle(width / 2, height / 2, width, height, enabled ? 0x344355 : 0x252c35, 1);
  background.setStrokeStyle(1, enabled ? 0x8392a2 : 0x535b64);
  const text = scene.add.text(width / 2, height / 2, label, {
    fontFamily: 'sans-serif',
    fontSize: '16px',
    color: enabled ? '#f4e6bf' : '#a0a5aa',
    align: 'center',
    wordWrap: { width: width - 12 },
  }).setOrigin(0.5);
  container.add([background, text]);
  container.setSize(width, height);
  if (enabled) {
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
    container.on('pointerdown', onClick);
    container.on('pointerover', () => background.setFillStyle(0x455a70));
    container.on('pointerout', () => background.setFillStyle(0x344355));
  } else {
    container.setAlpha(0.45);
  }
  return container;
}

export function createPanel(scene, { x, y, width, height, title }) {
  const container = scene.add.container(x, y);
  const background = scene.add.rectangle(width / 2, height / 2, width, height, 0x1a2531, 0.94);
  background.setStrokeStyle(1, 0x47576a);
  const heading = scene.add.text(width / 2, 20, title, {
    fontFamily: 'sans-serif',
    fontSize: '18px',
    color: '#f4e6bf',
    align: 'center',
  }).setOrigin(0.5);
  container.add([background, heading]);
  return container;
}

export function drawRarityFrame(scene, x, y, width, height, rarity) {
  const frame = scene.add.rectangle(x + width / 2, y + height / 2, width, height);
  frame.setFillStyle(0x000000, 0);
  frame.setStrokeStyle(2, RARITY_COLOR[rarity] ?? RARITY_COLOR.common);
  return frame;
}
