# KOSPI 선행지표 대시보드

Cloudflare Workers에서 도는 한 파일짜리 대시보드(`src/worker.js`)입니다: https://kospi.hwkim3330.workers.dev
시장·글로벌·지정학(Polymarket)·원화 스테이블 탭이 있고, index-board.space, 네이버 금융, Upbit, Binance 데이터를 프록시합니다.

## AI 예측 밴드 (TimesFM-3)

`forecast/forecast_kospi.py`가 코스피 지수, 삼성전자, SK하이닉스의 일별 종가를 받아 Google **TimesFM 3.0**(`google/timesfm-3.0-pytorch`, `timesfm==3.0.2`)으로 향후 20거래일의 중앙값과 q10/q90 구간을 제로샷으로 예측합니다. 데이터는 FinanceDataReader로 받습니다(네이버, 실패하면 Yahoo). 컨텍스트는 최근 1,024거래일입니다. 결과는 `forecast/forecast.json`에 저장됩니다.

- **갱신:** `.github/workflows/forecast.yml`이 평일 16:40 KST(장 마감 후)에 CPU torch로 스크립트를 돌리고 JSON이 바뀌었을 때만 커밋합니다. 모델 가중치(약 2.5 GB)는 Actions 캐시에 두며, 저장소에는 커밋하지 않습니다.
- **서빙:** Worker의 `/api/forecast`는 GitHub raw의 최신 `forecast.json`을 읽습니다(30분 캐시). 가져오지 못하면 배포 시 번들된 사본을 돌려줍니다. 그래서 매일 갱신에는 재배포가 필요 없습니다. 화면의 차트와 문구를 바꿀 때만 `npx wrangler deploy`를 실행하면 됩니다.
- **로컬 실행:** `pip install "timesfm[torch]==3.0.2" finance-datareader holidays` 후 `python forecast/forecast_kospi.py`를 실행합니다. Apple silicon에서 `timesfm[mlx]`가 설치돼 있으면 `TIMESFM_BACKEND=auto`로 MLX를 씁니다. 백엔드에 따라 결과가 조금 다를 수 있으며, 커밋된 JSON은 CI와 같은 torch CPU로 만듭니다.

### 백테스트 (실제 실행 결과, 2025-09-15 ~ 2026-09-23)

5거래일마다 예측 시점을 새로 잡아 47번 예측했습니다(rolling origin). 적중률은 실제 종가가 q10–q90 구간 안에 들어간 비율로, 목표는 80%입니다. 오차는 MAPE이고, 괄호 안은 "현재가가 그대로 유지된다"고 본 단순 예측(naive)의 오차입니다.

| 종목 | 5일 적중률 | 20일 적중률 | 5일 오차 (naive) | 20일 오차 (naive) |
|---|---|---|---|---|
| 코스피 | 79% | 64% | 5.16% (5.20%) | 11.56% (11.79%) |
| 삼성전자 | 77% | 68% | 6.70% (6.52%) | 16.32% (15.99%) |
| SK하이닉스 | 81% | 70% | 9.50% (9.35%) | 21.37% (21.76%) |

해석: 5일 구간은 명목 80%에 가깝지만, 20일 구간은 너무 좁아서 실제로는 64–70%만 맞았습니다. 중앙값 예측은 "현재가 유지"와 사실상 같은 수준입니다. 이 모델에 방향을 맞히는 능력이 있다고 볼 근거는 없습니다. 기간 중 코스피가 큰 폭으로 올랐기 때문에 방향 적중률(JSON의 `direction_hit_rate`)은 추세의 영향을 많이 받습니다. 이 수치들은 워크플로가 매일 다시 계산해 `forecast.json`의 `backtest`에 넣습니다.

### 주의 / 라이선스

- **투자 권유가 아닙니다.** 과거 종가만 본 통계적 추정이며 뉴스, 수급, 거시 변수는 반영하지 않습니다. 실제 가격은 구간 밖으로 자주 벗어납니다.
- TimesFM 코드는 Apache-2.0이지만, **TimesFM 3.0 사전학습 가중치는 `timesfm-non-commercial-license-v1.0`(비상업·비운영 용도 한정)** 입니다. 이 대시보드는 개인 연구용 실험이며, 상업 서비스나 운영 시스템에 쓰면 안 됩니다.

## 개발

```bash
npm install
npx wrangler dev          # 로컬
npx wrangler deploy       # 배포 (Cloudflare 로그인 필요)
```
