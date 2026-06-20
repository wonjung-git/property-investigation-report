# 물건조사서 (Cloudflare Workers + 정적 에셋)

## 구조
```
(레포 루트)
├── wrangler.toml      ← main="worker.js", 정적 에셋 = ./public
├── worker.js          ← 공공데이터포털 프록시(/api/registry) + index.html 키 주입
└── public/
    └── index.html     ← 화면. V-World는 브라우저에서 직접 호출(JSONP/img)
```

## 왜 이렇게 나눴나
V-World 서버는 Cloudflare 엣지(Workers)에서 오는 요청을 차단해서 워커가 부르면
520/502가 납니다. 그래서 **V-World(지오코딩·필지·용도지역·정적지도)는 브라우저에서
직접** 호출하고, **워커는 공공데이터포털(건축물대장·실거래가)만** 프록시합니다.
V-World 키는 도메인 등록형이라 브라우저 직접 호출이 정상 사용법입니다.

## 키
워커 → Settings → Variables and Secrets 에 Secret으로 등록:

| 이름 | 용도 |
|------|------|
| `VWORLD_KEY` | 워커가 index.html의 `{{VWORLD_KEY}}` 자리에 주입 → 브라우저가 사용 |
| `DATA_GO_KR_KEY` | 워커가 건축물대장·실거래가 호출에 사용 (Decoding 키) |

> `VWORLD_KEY`는 레포에 저장되지 않습니다(HTML엔 `{{VWORLD_KEY}}` placeholder만).
> 워커가 서빙 시점에 주입하므로 GitHub에 올라가지 않습니다.

## 배포
1. 위 구조로 커밋 & 푸시 → Cloudflare 자동 빌드(`npx wrangler deploy`).
2. 빌드 성공 후 Secret 2개 등록 → 한 번 더 재배포.
3. `https://<프로젝트>.workers.dev` 에서 실주소로 테스트.

## 흐름
```
브라우저 ─(JSONP)→ V-World: 주소→좌표→PNU→지목/면적→용도지역
브라우저 ─(img)──→ V-World 정적지도
브라우저 ─(/api/registry?pnu=)→ 워커 → 공공데이터포털: 건축물대장 + 실거래가
```

## 참고
- 등기 권리관계(소유자·근저당)는 무료 오픈 API가 없어 자동으로 못 채웁니다.
- 실거래/건축물이 비면: 공공데이터포털 키가 Decoding인지, 활용신청 승인·활성화됐는지 확인.
