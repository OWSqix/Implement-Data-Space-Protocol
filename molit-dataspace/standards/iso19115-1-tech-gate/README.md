# ISO 19115-1 공개 기술 Gate

## 판정

ISO/TC 211은 `/19115/-1/`의 현재 package를 `1.3.0`으로 게시한다. 공식 package에는 18개 module XSD, Schematron과 XML 예제가 있다.

공식 GitHub 저장소는 schema의 저작권자를 ISO/TC 211로 표시하지만 별도 `LICENSE` 파일이나 재배포 허락은 두지 않았다. ISO 저작권 정책은 서면 허락 없는 복제·재게시를 금지한다.

따라서 이 저장소에는 공식 XSD·Schematron·예제 bytes를 넣지 않는다. `manifest.json`에는 URL, 응답 media type, byte 수, SHA-256과 수집시각만 기록한다. Gate 상태는 `blocked-pending-permission-or-approved-private-cache`다.

근거:

- [ISO 19115 Part 1 package](https://schemas.isotc211.org/19115/-1/)
- [ISO/TC 211 schema repository](https://github.com/ISO-TC211/schemas)
- [ISO copyright policy](https://www.iso.org/copyright.html)

## 캡처

기관의 법무·저작권 담당자가 private validation cache 사용을 승인한 환경에서만 다음 명령을 실행한다.

```powershell
node tools/iso19115-tech/capture.mjs --acknowledge-iso-copyright-restrictions
```

명령은 다음 작업만 수행한다.

1. 허용한 공식 host에서 18개 module XSD와 import·include closure를 수집한다.
2. `metadata-minimal.sch`와 `D.1Minimal.xml`을 수집한다.
3. bytes를 `.local/iso19115-1-tech-gate/`에 저장한다.
4. digest manifest를 이 디렉터리에 기록한다.

`.local/`은 Git 대상이 아니다. 이 명령은 이용·재배포 권리를 부여하지 않는다.

기존 manifest와 URL·digest·byte 수가 다르면 명령은 `.local/iso19115-1-tech-gate/manifest.candidate.json`만 만들고 실패한다. 차이를 검토한 뒤에만 `--approve-reviewed-manifest`를 붙여 정본을 갱신한다.

## 오프라인 검증

```powershell
node tools/iso19115-tech/offline.mjs verify
node tools/iso19115-tech/offline.mjs smoke
```

`verify`는 125개 artifact의 byte 수와 SHA-256을 검사한다. `smoke`는 network를 사용하지 않고 다음 네 판정을 실행한다.

- 공식 `D.1Minimal.xml`의 XSD package validation 성공
- root element를 바꾼 XSD negative 거부
- 공식 `metadata-minimal.sch` validation 성공
- metadata creation date type을 바꾼 Schematron negative 거부

XSD package에는 단일 통합 schema가 없다. 검증기는 공식 package manifest와 같은 18개 module entrypoint를 local driver XSD에서 import한다. 공식 파일 내용은 바꾸지 않고 `schemaLocation`만 private cache의 content-addressed 이름으로 연결한다.

## CI 동작

CI는 capture 명령을 실행하지 않는다. 승인된 private cache가 주입되면 공식 positive·negative smoke를 실행한다. cache가 없으면 공식 적합 판정을 만들지 않고 Gate가 차단 상태인지 확인한다.

별도의 `tests/fixtures/iso19115-tech-harness/`는 parser와 XSD·Schematron 실행기의 정상·오류 판정을 network 없이 시험한다. 이 fixture는 프로젝트가 작성한 `urn:molit:iso19115-tech-harness` 자료다. ISO schema나 ISO 예제의 대체 증거가 아니다.
