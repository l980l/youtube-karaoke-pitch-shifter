#!/bin/bash
# YouTube Karaoke Extension - Quick Launcher for macOS
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "🎤 유튜브 노래방 키 조절기 간편 실행 도우미"
echo "=========================================="
echo "1) 크롬 확장 프로그램 관리 페이지를 엽니다..."
open -a "Google Chrome" "chrome://extensions"

echo "2) 확장 프로그램 폴더를 엽니다..."
open "$DIR"

echo "👉 [개발자 모드]가 켜져 있다면, 열린 폴더를 크롬 창으로 '드래그 앤 드롭'만 하면 설치 완료됩니다!"
