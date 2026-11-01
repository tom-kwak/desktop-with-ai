# ReviewDesk

커밋과 브랜치를 AI로 리뷰하는 데스크톱 Git 클라이언트입니다. [GitHub Desktop](https://github.com/desktop/desktop)을 포크해서 AI 리뷰와 커밋 그래프를 더했고, 기존 기능은 그대로 동작합니다.

**[소개 페이지](https://tom-kwak.github.io/desktop-with-ai/)** · [다운로드](https://github.com/tom-kwak/desktop-with-ai/releases/latest/download/ReviewDesk-arm64.zip) · [릴리스 노트](https://github.com/tom-kwak/desktop-with-ai/releases)

> 개인 포크이며 GitHub의 공식 제품이 아닙니다. 문제는 GitHub Desktop이 아니라 [이 저장소](https://github.com/tom-kwak/desktop-with-ai/issues)에 알려 주세요.

## Quick Start

Apple Silicon Mac에서 터미널에 붙여 넣으면 최신 버전이 설치됩니다. 앱이 실행 중이면 먼저 종료하세요.

```bash
curl -L https://github.com/tom-kwak/desktop-with-ai/releases/latest/download/ReviewDesk-arm64.zip -o /tmp/ReviewDesk.zip && unzip -oq /tmp/ReviewDesk.zip -d /Applications && xattr -dr com.apple.quarantine /Applications/ReviewDesk.app
```

## 추가한 기능

- **AI 리뷰**: History 위쪽 바에서 선택한 커밋(`Review N commits`)이나 현재 브랜치(`Review branch`)를 리뷰합니다. 결과는 요약, 주요 변경, 위험 요소, 커밋 품질로 정리됩니다. API 키 없이 컴퓨터에 설치되고 로그인된 에이전트 CLI를 실행합니다.
  - Claude Code: 기본값이며 동작을 확인했습니다.
  - Codex CLI, Gemini CLI: 선택할 수 있지만 끝까지 실행해 보지 못했습니다.
- **저장소를 읽는 리뷰**: 설정에서 `Let the agent read files in the repository`를 켜면 diff 밖의 코드도 참고합니다. Claude Code 전용이고 읽기 도구만 허용하며 기본값은 꺼짐입니다. 읽은 내용은 에이전트 서비스로 전송됩니다.
- **리뷰 이력**: 리뷰는 자동 저장되고, 같은 입력이면 저장된 리뷰를 다시 보여 줍니다(`Review again`으로 새로 실행). `Past reviews`에서 SHA, 메시지, 브랜치, 내용, 에이전트로 찾습니다. 이 컴퓨터에만 저장되며 암호화하지 않습니다.
- **리뷰 설정**: 톱니바퀴 버튼에서 에이전트, 모델, 저장소 읽기, 프롬프트(수정, 추가)를 정합니다. 전체 기본값과 프로젝트별 설정이 따로 있습니다.
- **커밋 그래프**: History 목록 왼쪽에 브랜치 흐름을 그리고, 커밋을 선택하면 같은 브랜치의 커밋을 강조합니다. 브랜치 이름 칩과 현재 브랜치 링도 표시됩니다.

## 설치 참고

Apple Silicon Mac 전용입니다. 위 Quick Start 명령은 최신 버전을 받아 `/Applications`에 설치하고, 공증을 받지 않은 앱에 macOS가 띄우는 "확인되지 않은 개발자" 경고를 건너뛰도록 격리 표시(`xattr`)를 지웁니다. 업데이트할 때도 같은 명령을 씁니다.

- 직접 설치하려면 [zip](https://github.com/tom-kwak/desktop-with-ai/releases/latest/download/ReviewDesk-arm64.zip)의 압축을 풀고 `ReviewDesk.app`을 응용 프로그램 폴더로 옮긴 뒤, 막히면 시스템 설정의 개인정보 보호 및 보안에서 허용하세요.
- 실행 중에는 앱을 옮기지 마세요. 옮기면 내장 Git을 찾지 못합니다. 옮겼다면 앱을 종료하고 다시 실행하세요.
- AI 리뷰를 쓰려면 [Claude Code](https://claude.com/claude-code)를 설치하고 터미널에서 로그인해 둡니다.

## 직접 빌드하기

환경 준비는 [`setup.md`](./docs/contributing/setup.md)를 따릅니다.

```bash
yarn && yarn build:dev && yarn start        # 개발판 실행
RELEASE_CHANNEL=development yarn build:prod && RELEASE_CHANNEL=development yarn package   # dist/에 앱 생성
```

`RELEASE_CHANNEL=development`를 빼면 앱이 Apple 서명을 요구하고 공식 GitHub Desktop으로 자동 업데이트될 수 있습니다.

## 브랜치와 릴리스

| 브랜치 | 역할 |
| --- | --- |
| `main` | 제품 브랜치. 릴리스는 여기서만 나갑니다. |
| `develop` | 기능을 합치고 검증하는 기준 브랜치입니다. |
| `feature/{기능명}` | `develop`에서 만들어 PR로 `develop`에 합칩니다. |

`develop`을 `main`에 합친 뒤 `main`의 커밋에 `release-vX.Y.Z` 태그를 푸시하면 [GitHub Actions](.github/workflows/reviewdesk-release.yml)가 앱을 빌드해 Release에 올립니다. `main`에 없는 커밋의 태그는 실패합니다. PR은 [ReviewDesk CI](.github/workflows/reviewdesk-ci.yml)(타입 체크, 서식, 린트, 테스트)가 확인하고, 소개 페이지([`website/`](website/))는 `main`에 푸시하면 배포됩니다.

## 알려진 한계

- macOS Apple Silicon 빌드만 제공합니다. Windows 코드는 시험하지 않았습니다.
- 업스트림 병합을 쉽게 하려고 앱 안에 "GitHub Desktop" 문구를 그대로 두었습니다.
- 한 번에 보내는 diff는 12만 자, 커밋 로그는 4만 자까지이고 넘으면 잘립니다.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo
designs. GitHub reserves all trademark and copyright rights in and to all
GitHub trademarks. GitHub's logos include, for instance, the stylized
Invertocat designs that include "logo" in the file title in the following
folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's
Trademarks or registered Trademarks. When using GitHub's logos, be sure to
follow the GitHub [logo guidelines](https://github.com/logos).
