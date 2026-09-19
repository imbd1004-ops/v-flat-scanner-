# V-Flat Scanner

책을 바닥에 펼쳐 두고 휴대폰 카메라를 비추기만 하면 되는 개인용 OCR 스캔 앱입니다.
페이지를 **자동으로 찾아 → 손을 떼고 있으면 자동 촬영 → 스파인 쪽으로 휘어진 굴곡을 평평하게 펴고 → 기기 안에서 바로 글자를 인식**합니다.
서버가 없고, 인터넷 없이도 동작하며, 홈 화면에 앱으로 설치할 수 있습니다(PWA).

## 사용 흐름 (3단계)

1. 앱을 열고 **카메라 시작**을 누릅니다.
2. 책을 향해 카메라를 대고 잠시 멈춥니다. 페이지 윤곽이 초록색으로 바뀌면 자동으로 촬영됩니다. (자동 촬영 끄기 가능, 셔터 버튼으로 수동 촬영도 가능)
3. 1초 내외로 평탄화된 페이지 이미지와 인식된 텍스트가 나타납니다. 복사 · 공유 · 이미지 저장 · 다음 페이지로 이어서 스캔.

갤러리의 사진을 불러와 같은 처리를 할 수도 있습니다. 모든 스캔은 기기의 IndexedDB에 저장되며 기록 화면에서 전체 텍스트를 한 번에 내보낼 수 있습니다.

## 동작 원리

| 단계 | 구현 | 위치 |
| --- | --- | --- |
| 페이지 감지 | 프리뷰를 360px로 축소 → Canny + 적응형 임계값 → 가장 큰 볼록 윤곽 → 4모서리 근사 → 안정성 검사 | `src/cv/detect.ts`, `src/geometry.ts` |
| 자동 촬영 | 10프레임 동안 모서리 이동이 화면 폭의 1.2% 이하이면 촬영, 같은 페이지는 재촬영하지 않음 | `StabilityTracker` (`src/geometry.ts`) |
| 초점 관리 | 페이지 중앙을 원본 해상도로 잘라 라플라시안 분산으로 선명도를 측정. 기준 미달이면 자동 촬영을 보류하고 단일 초점(single-shot)을 강제 재실행. 화면 탭으로 초점 위치 지정 | `src/cv/sharpness.ts`, `src/camera.ts` |
| 정지사진 촬영 | 지원 기기에서는 `ImageCapture.takePhoto()`로 센서 전체 해상도 사진을 찍고, 프리뷰 프레임과 선명도를 비교해 더 또렷한 쪽을 사용. 흐리면 재초점 후 1회 재시도 | `src/camera.ts`, `src/main.ts` |
| 굴곡 평탄화 | 윤곽점을 상/하단 모서리에 배정해 2차 곡선으로 휨 프로파일을 피팅하고, 열(column)마다 상·하 곡선 사이를 선형 보간하는 리맵 그리드를 만들어 `cv.remap` | `src/geometry.ts` (`fitCurvedQuad`, `buildRemap`), `src/cv/dewarp.ts` |
| 보정 | 배경 조명 추정 후 나누기(스파인 그림자 제거) + 언샤프 마스크 | `src/cv/enhance.ts` |
| OCR | Tesseract.js (LSTM, `kor+eng`), 언어 데이터와 WASM을 앱에 동봉하여 첫 실행부터 오프라인 동작. 앱 시작 시 미리 로드해 인식 지연 최소화 | `src/ocr.ts` |
| 저장 | IndexedDB (이미지 JPEG + 텍스트) | `src/store.ts` |

OpenCV.js와 Tesseract 코어는 CDN이 아닌 앱 자체 경로(`public/vendor`, 빌드 시 `node_modules`에서 복사)에서 제공되어 서비스워커가 전부 캐시합니다.

## 개발

```bash
npm install
npm run dev        # http://<PC-IP>:5173 — 폰에서 열려면 HTTPS 또는 localhost 필요(아래 참고)
npm test           # 기하 연산 단위 테스트 (vitest)
npm run test:e2e   # 빌드 후 Chromium에서 합성 곡면 페이지로 평탄화 + OCR 검증 (playwright)
npm run build      # dist/ 생성 (PWA 포함)
```

Playwright가 설치된 브라우저를 못 찾으면 `CHROMIUM_PATH=/path/to/chrome npx playwright test`.

## 휴대폰에 설치하기

카메라 API는 HTTPS(또는 localhost)에서만 열립니다. 가장 쉬운 방법은 GitHub Pages입니다.

1. `main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 Pages를 활성화하고 `https://<계정>.github.io/<저장소>/`에 배포합니다.
2. 휴대폰 Chrome/Safari에서 그 주소를 열고 **홈 화면에 추가**를 누르면 전체화면 앱으로 실행됩니다. 이후에는 오프라인에서도 동작합니다.

같은 Wi-Fi에서 개발 중에 테스트하려면 `npm run dev` 후 `ngrok http 5173` 같은 터널이나, Chrome의 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`에 PC 주소를 등록하는 방법을 쓸 수 있습니다.

## 잘 찍히는 조건

- 책 전체 윤곽이 화면 안에 들어오고, 배경(책상)과 종이의 밝기 차이가 있을 때.
- 조명이 고르고 손 그림자가 페이지를 가리지 않을 때. 어두우면 🔦 버튼으로 손전등을 켤 수 있습니다(지원 기기).
- 초점이 안 잡히면 화면의 글자 부분을 탭하세요. 너무 가까우면(약 15cm 이내) 접사 한계로 초점이 안 맞을 수 있으니 조금 떨어뜨립니다.
- 한 번에 한 페이지. 양면을 펼친 상태면 스파인을 기준으로 한쪽 페이지만 화면에 담는 편이 정확합니다.

## 한계와 다음 단계

- 곡면 모델은 상·하단 모서리의 2차 휨만 다룹니다. 스파인 근처의 수평 압축(글자 폭이 좁아지는 현상)은 보정하지 않지만 OCR에는 큰 영향이 없습니다.
- Tesseract fast 모델을 사용합니다. 정확도가 더 필요하면 `public/tessdata`의 파일을 `tessdata_best`로 교체하면 됩니다(속도는 느려짐).
- 양면 자동 분할, 여러 페이지 PDF 내보내기는 아직 없습니다.
