# ReviewDesk

커밋과 브랜치를 AI로 리뷰하는 데스크톱 Git 클라이언트입니다.

[GitHub Desktop](https://github.com/desktop/desktop)을 포크해서 History 화면에 AI
리뷰와 커밋 그래프를 더했습니다. 평소 쓰던 Git 클라이언트 안에서 변경사항을 리뷰하고,
지난 리뷰를 다시 찾아볼 수 있습니다.

**[ReviewDesk 다운로드](https://tom-kwak.github.io/desktop-with-ai/)** (macOS, Apple Silicon)

> ReviewDesk는 개인 포크이며 GitHub의 공식 제품이 아닙니다. GitHub은 이 앱을 보증하거나
> 지원하지 않습니다. 문제가 있으면 GitHub Desktop이 아니라
> [이 저장소](https://github.com/tom-kwak/desktop-with-ai/issues)에 알려 주세요.

## 추가한 기능

### AI 리뷰

History 탭 위쪽 바에서 바로 실행합니다.

- **Review N commits**: 선택한 커밋을 리뷰합니다. 연속된 여러 커밋도 선택할 수 있습니다.
- **Review branch**: 현재 브랜치가 기준 브랜치와 비교해 무엇을 바꿨는지 Pull Request처럼
  리뷰합니다. 원하면 아직 커밋하지 않은 변경도 포함합니다.
- 결과는 요약, 주요 변경, 위험 요소, 커밋 품질로 나뉘어 마크다운으로 표시됩니다.

API 키는 필요 없습니다. 컴퓨터에 설치되고 로그인된 에이전트 CLI를 실행합니다.

| 에이전트 | 상태 |
| --- | --- |
| Claude Code | 기본값. 실제로 동작을 확인했습니다. |
| Codex CLI | 선택할 수 있지만 실행해 보지 못했습니다. |
| Gemini CLI | 선택할 수 있지만 끝까지 실행해 보지 못했습니다. |

### 저장소를 읽는 리뷰

기본적으로 에이전트는 커밋 로그와 diff만 봅니다. 설정에서
**Let the agent read files in the repository**를 켜면 호출하는 쪽이나 테스트 같은 주변
코드까지 읽고 리뷰합니다.

- Claude Code 전용입니다. Codex CLI와 Gemini CLI는 항상 저장소 밖에서 실행됩니다.
- 읽기 도구(Read, Grep, Glob)만 허용하므로 파일을 바꾸거나 명령을 실행할 수 없습니다.
- 저장소가 설정한 훅과 MCP 서버는 무시합니다.
- 기본값은 꺼짐입니다. 에이전트가 읽은 내용은 에이전트 서비스로 전송됩니다.

### 리뷰 이력

리뷰는 자동으로 저장됩니다.

- **재사용**: 같은 커밋 로그와 diff를 같은 설정으로 다시 열면 에이전트를 돌리지 않고 저장된
  리뷰를 보여 줍니다. 저장소 읽기를 켰다면 저장소 파일 상태까지 같을 때만 재사용합니다.
- **Review again**: 새로 리뷰해서 이력에 추가합니다. 이전 리뷰는 남습니다.
- **Past reviews**: 저장소의 모든 리뷰를 모아 봅니다. 리뷰한 커밋과 커밋 메시지를 함께 보여
  주고, SHA, 커밋 메시지, 브랜치, 리뷰 내용, 유형, 에이전트로 필터링할 수 있습니다.

리뷰는 이 컴퓨터의 앱 데이터에만 저장되고 암호화하지 않습니다. 저장소당 500개, 전체
5천만 자까지 보관하며 넘으면 오래된 것부터 지웁니다.

### 설정

History 바의 톱니바퀴 버튼에서 바꿉니다.

- 에이전트, 모델, 저장소 읽기 여부, 리뷰 프롬프트를 고를 수 있고 모두 기본값이 있습니다.
- **Defaults for all projects**와 **This project** 두 범위가 있어서 프로젝트마다 다르게
  설정할 수 있습니다.
- 기본 프롬프트를 고칠 수 있고, 프롬프트를 새로 만들 수도 있습니다.

### 커밋 그래프

History 목록 왼쪽에 브랜치가 갈라지고 합쳐지는 흐름을 그립니다. 브랜치마다 열과 색이 다르고,
병합 커밋은 가운데에 흰 점이 있습니다.

## 설치

[다운로드 페이지](https://tom-kwak.github.io/desktop-with-ai/)에서 내려받습니다.
[zip 파일을 바로 받거나](https://github.com/tom-kwak/desktop-with-ai/releases/latest/download/ReviewDesk-arm64.zip)
[지난 버전](https://github.com/tom-kwak/desktop-with-ai/releases)을 찾을 수도 있습니다.
Apple Silicon Mac 전용입니다.

1. 압축을 풀고 `ReviewDesk.app`을 응용 프로그램 폴더로 옮깁니다.
2. 응용 프로그램 폴더에서 실행합니다.
3. AI 리뷰를 쓰려면 [Claude Code](https://claude.com/claude-code)를 설치하고 터미널에서
   로그인해 둡니다.

- **실행 중에는 앱을 옮기지 마세요.** 시작할 때의 경로로 내장 Git을 찾기 때문에 옮기면 Git이
  동작하지 않습니다. 옮겼다면 앱을 종료하고 다시 실행하세요.
- 앱이 Apple 공증을 받지 않아서 macOS가 실행을 막을 수 있습니다. 출처를 신뢰한다면 시스템
  설정의 개인정보 보호 및 보안에서 허용하거나 아래 명령을 실행하세요.

  ```bash
  xattr -dr com.apple.quarantine /Applications/ReviewDesk.app
  ```

## 직접 빌드하기

개발 환경 준비는 [`setup.md`](./docs/contributing/setup.md)를 따릅니다.

```bash
yarn
```

개발판을 빌드하고 실행합니다.

```bash
yarn build:dev
```

```bash
yarn start
```

실행 파일을 만듭니다. 결과물은 `dist/`에 생깁니다.

```bash
RELEASE_CHANNEL=development yarn build:prod
```

```bash
RELEASE_CHANNEL=development yarn package
```

`RELEASE_CHANNEL=development`를 빼면 앱이 Apple 서명을 요구하고, 공식 GitHub Desktop으로
자동 업데이트될 수 있습니다.

`reviewdesk-v1.0.0` 같은 태그를 푸시하면
[GitHub Actions](.github/workflows/reviewdesk-release.yml)가 앱을 빌드해 Release에 올립니다.
[다운로드 페이지](https://tom-kwak.github.io/desktop-with-ai/)의 소스는
[`website/`](website/)에 있고, `master`에 푸시하면 자동으로 배포됩니다.

## 코드 구조

업스트림을 계속 병합할 수 있도록 기능은 대부분 새 파일에 있습니다.

| 경로 | 내용 |
| --- | --- |
| `app/src/lib/ai/` | 에이전트 실행, 설정, 리뷰 이력, 전용 DB |
| `app/src/lib/git/ai-analysis-input.ts` | 리뷰할 커밋과 diff 수집 |
| `app/src/ui/ai-analysis/` | 바와 리뷰, 이력, 설정 다이얼로그 |
| `app/src/lib/commit-graph.ts` | 커밋 그래프 레이아웃 계산 |
| `app/src/ui/history/commit-graph-cell.tsx` | 커밋 그래프 그리기 |
| `app/test/unit/ai/` | AI 기능 테스트 |

```bash
yarn test app/test/unit/ai
```

## 알려진 한계

- macOS Apple Silicon 빌드만 제공합니다. Windows 코드는 시험하지 않았습니다.
- 앱 안의 메뉴와 일부 화면에 "GitHub Desktop" 문구가 남아 있습니다. 업스트림 병합을 쉽게 하려고
  일부러 바꾸지 않았습니다.
- 커밋 그래프는 6열까지 그립니다. 그보다 많은 브랜치는 마지막 열에 겹칩니다.
- `.gitignore`에 있는 파일이 바뀐 것은 리뷰 재사용 판단에 반영되지 않습니다. 이럴 때는
  **Review again**을 쓰세요.
- 한 번에 보내는 diff는 12만 자, 커밋 로그는 4만 자까지입니다. 넘으면 잘립니다.

<details>
<summary>원본 GitHub Desktop 안내 (참고용)</summary>

아래는 포크한 시점의 GitHub Desktop README입니다. ReviewDesk가 아니라 GitHub Desktop에 대한
내용입니다.

# [GitHub Desktop](https://desktop.github.com)

[GitHub Desktop](https://desktop.github.com/) is an open-source [Electron](https://www.electronjs.org/)-based
GitHub app. It is written in [TypeScript](https://www.typescriptlang.org) and
uses [React](https://reactjs.org/).

<picture>
  <source
    srcset="https://user-images.githubusercontent.com/634063/202742848-63fa1488-6254-49b5-af7c-96a6b50ea8af.png"
    media="(prefers-color-scheme: dark)"
  />
  <img
    width="1072"
    src="https://user-images.githubusercontent.com/634063/202742985-bb3b3b94-8aca-404a-8d8a-fd6a6f030672.png"
    alt="A screenshot of the GitHub Desktop application showing changes being viewed and committed with two attributed co-authors"
  />
</picture>

## Where can I get it?

Download the official installer for your operating system:

 - [macOS](https://central.github.com/deployments/desktop/desktop/latest/darwin)
 - [macOS (Apple silicon)](https://central.github.com/deployments/desktop/desktop/latest/darwin-arm64)
 - [Windows](https://central.github.com/deployments/desktop/desktop/latest/win32)
 - [Windows machine-wide install](https://central.github.com/deployments/desktop/desktop/latest/win32?format=msi)

Linux is not officially supported; however, you can find installers created for Linux from a fork of GitHub Desktop in the [Community Releases](https://github.com/desktop/desktop#community-releases) section.

### Beta Channel

Want to test out new features and get fixes before everyone else? Install the
beta channel to get access to early builds of Desktop:

 - [macOS](https://central.github.com/deployments/desktop/desktop/latest/darwin?env=beta)
 - [macOS (Apple silicon)](https://central.github.com/deployments/desktop/desktop/latest/darwin-arm64?env=beta)
 - [Windows](https://central.github.com/deployments/desktop/desktop/latest/win32?env=beta)
 - [Windows (ARM64)](https://central.github.com/deployments/desktop/desktop/latest/win32-arm64?env=beta)

The release notes for the latest beta versions are available [here](https://desktop.github.com/release-notes/?env=beta).

### Past Releases
You can find past releases at https://desktop.githubusercontent.com. After installation of a past version, the auto update functionality will attempt to download the latest version. 

### Community Releases

There are several community-supported package managers that can be used to
install GitHub Desktop:
 - Windows users can install using [winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/) `c:\> winget install github-desktop` or [Chocolatey](https://chocolatey.org/) `c:\> choco install github-desktop`
 - macOS users can install using [Homebrew](https://brew.sh/) package manager:
      `$ brew install --cask github`

Installers for various Linux distributions can be found on the
[`shiftkey/desktop`](https://github.com/shiftkey/desktop) fork.

## Is GitHub Desktop right for me? What are the primary areas of focus?

[This document](https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md) describes the focus of GitHub Desktop and who the product is most useful for.

## I have a problem with GitHub Desktop

Note: The [GitHub Desktop Code of Conduct](https://github.com/desktop/desktop/blob/development/CODE_OF_CONDUCT.md) applies in all interactions relating to the GitHub Desktop project.

First, please search the [open issues](https://github.com/desktop/desktop/issues?q=is%3Aopen)
and [closed issues](https://github.com/desktop/desktop/issues?q=is%3Aclosed)
to see if your issue hasn't already been reported (it may also be fixed).

There is also a list of [known issues](https://github.com/desktop/desktop/blob/development/docs/known-issues.md)
that are being tracked against Desktop, and some of these issues have workarounds.

If you can't find an issue that matches what you're seeing, open a [new issue](https://github.com/desktop/desktop/issues/new/choose),
choose the right template and provide us with enough information to investigate
further.

## The issue I reported isn't fixed yet. What can I do?

If nobody has responded to your issue in a few days, you're welcome to respond to it with a friendly ping in the issue. Please do not respond more than a second time if nobody has responded. The GitHub Desktop maintainers are constrained in time and resources, and diagnosing individual configurations can be difficult and time consuming. While we'll try to at least get you pointed in the right direction, we can't guarantee we'll be able to dig too deeply into any one person's issue.

## How can I contribute to GitHub Desktop?

The [CONTRIBUTING.md](./.github/CONTRIBUTING.md) document will help you get setup and
familiar with the source. The [documentation](docs/) folder also contains more
resources relevant to the project.

If you're looking for something to work on, check out the [help wanted](https://github.com/desktop/desktop/issues?q=is%3Aissue+is%3Aopen+label%3A%22help%20wanted%22) label.

## Building Desktop

To setup your development environment for building Desktop, check out: [`setup.md`](./docs/contributing/setup.md).

## More Resources

See [desktop.github.com](https://desktop.github.com) for more product-oriented
information about GitHub Desktop.

See our [getting started documentation](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop) for more information on how to set up, authenticate, and configure GitHub Desktop.

</details>

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
