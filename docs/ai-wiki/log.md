---
title: log
type: schema
status: active
updated: 2026-11-01
---

# log — 작업 로그

`save`를 마칠 때마다 **맨 아래에 한 줄씩 추가**합니다. 기존 줄은 수정하거나 삭제하지 않습니다(append-only).
`reference`는 읽기 전용이므로 기록하지 않습니다.

형식:

```text
- YYYY-MM-DD HH:mm | command | 한 줄 요약 | [[관련 문서]]
```

## Log

- 2026-11-01 | save | 위키 초기화 + 1차 분석/개선 인수인계 기록 | [[2026-11-01-프로젝트-파악-및-개선-1차]]
