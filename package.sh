#!/bin/bash
# 배포용 ZIP 압축 파일 생성 스크립트
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
OUTPUT="$DIR/youtube-karaoke-extension.zip"

rm -f "$OUTPUT"
zip -r "$OUTPUT" manifest.json icons/ content/ popup/ background/ README.md -x "*.DS_Store"

echo "✅ 배포용 ZIP 생성 완료: $OUTPUT"
