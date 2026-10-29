# 현장 진입 타이머 (소방청)

대별 진입시간을 실시간으로 재서 대기·진입중·경고·위험을 한눈에 보여 주는 소방관 현장 안전 타이머.
데이터는 각 기기(브라우저 localStorage)에만 저장된다.

## 실행 (Docker)

```bash
docker compose up -d --build
```

브라우저에서 http://localhost:8081 접속.

중지: `docker compose down`

## 구성

- `public/` — 앱 파일 (index.html, app.js, intro.js, storage.js, styles.css, sw.js …)
- `Dockerfile`, `nginx.conf` — nginx 로 `public/` 을 서비스
- `docker-compose.yml` — 8081 포트로 실행

## 이전 버전과 달라진 점

- 소방 서비스 더보기 링크 삭제
- 처음 실행 시 자동 사용방법 안내 삭제 (📖 사용방법 안내 버튼을 눌러야만 표시)
- Firebase 호스팅 대신 Docker(nginx)로 배포
