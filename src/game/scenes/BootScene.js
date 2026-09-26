import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    this.add
      .text(640, 330, '마창기사', {
        fontFamily: 'sans-serif',
        fontSize: '48px',
        color: '#f4e6bf',
      })
      .setOrigin(0.5);
    this.add
      .text(640, 390, '마을 화면 준비 중', {
        fontFamily: 'sans-serif',
        fontSize: '22px',
        color: '#b8c3d1',
      })
      .setOrigin(0.5);
  }
}
