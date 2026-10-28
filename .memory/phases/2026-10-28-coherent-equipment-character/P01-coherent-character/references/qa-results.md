# 시각 검증 기록

- 2026-10-28. 개발 서버 `http://127.0.0.1:5174/`의 로컬 게스트 마을과 일반 전투를 확인했다. `qa-town-local.png`와 `qa-battle-local.png`는 로컬 화면의 게임 영역이다. 전투 화면에서 기사·말 합성과 발굽 접지를 확인했다.
- 실제 `TownScene`을 테스트 데이터로 열고 `equipGear()` 및 `commitState()`를 실행해 투구 장착을 바꿨다. 미리보기의 두 텍스처가 `gear-helmet-common`, `gear-helmet-common-front`에서 `gear-helmet-legendary`, `gear-helmet-legendary-front`로 바뀌었다. `qa-town-swap-local.png`는 교체 후 화면이다.
- 실제 `BattleScene`을 로컬 테스트 티켓과 클라이언트로 열었다. `rankedEligible=true`, `rankedRunState` 존재를 확인했고 `qa-ranked-local.png`에 표시를 기록했다. `qa-battle-poses.png`는 같은 장면에서 접촉·피격·쓰러짐 프레임과 좌측 방향을 지정한 화면이다. 걷기 리그를 이동시키자 장비 프레임은 1,2,3,0,1,2로 따라갔다. 이는 로컬 시뮬레이션 화면 검증이며 실제 랭킹 서버 발급이나 결과 검증이 아니다.
- 실제 `PvpScene`을 Common 플레이어와 Legendary 상대의 테스트 스냅샷으로 열어 양쪽의 기마 모습을 확인했다. `qa-pvp-local.png`는 로컬 화면이다. 매칭·서버 응답·레이팅은 검증하지 않았다. PvP 장면은 현재 걷기 프레임만 사용한다.
- `qa-atlas-combinations.png`는 전체 Common, 전체 Legendary 및 혼합 희귀도 조합의 11개 프레임을 실제 atlas에서 재합성해 확인한 자료다. 프레임 경계와 외형 품질은 자동 테스트만으로 보장할 수 없다.

## 에셋 재생성
- `frames/{pose}/{slot}-{part}.png` 132개가 포장 기준이다. 256×256 RGBA이며 모든 파트는 동일 포즈 좌표를 쓴다. Python의 Pillow가 필요하다.
- `python scripts/build-equipment-appearance.py` 또는 `powershell -File scripts/build-equipment-appearance.ps1`로 60개 시트를 생성한다. 각 기마 프레임은 모든 파트를 같은 비율로 옮겨 바닥 기준에 맞추고, 개별 파트를 따로 자르거나 확대하지 않는다.
- `drafts/build-extended-draft.py`와 `drafts/pose-*.png`, `drafts/horse-*.png`는 시안 생성·분리 이력이다. 이 스크립트는 Pillow와 NumPy가 필요하며 실행 후 결과를 육안 확인해야 한다. 런타임 atlas의 직접 원본은 `frames/`다.
