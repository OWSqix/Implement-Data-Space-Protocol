# EDC·CaaS·DSaaS 작업 인계 기록

작성일: 2026-07-14 KST
상태: 구현 후보 검증 완료, 구현 commit 기준 EDC smoke 재실행 대기

## 1. 인계 기준

- **(기준선)** 작업 시작 commit은 `044dfda`
- **(구현 상태)** EDC 로컬 구성, CaaS·DSaaS 제어면, Bridge HTTP 방어, Provider transfer worker 구현 완료
- **(시험 상태)** 단위·통합·focused 시험과 EDC runtime 검증 통과
- **(증거 상태)** clean worktree와 clean volume에서 생성할 EDC raw run은 `pending-rerun`
- **(금지 사항)** 상위 경로의 기획보고서 PDF는 이 저장소의 commit 대상에서 제외

이 문서의 시험 수는 2026-07-14에 실행한 결과다. focused suite는 전체 unit·integration suite와 중복되므로 합산하지 않는다.

## 2. 구현 범위

### 2.1 EDC 로컬 구성과 증거 기록

- Eclipse EDC 0.18.0 Provider·Consumer Control Plane과 Data Plane 분리 구성
- Management API v4와 DSP 2025-1 Catalog·계약 협상·PULL·종료 흐름 구현
- Java 17 bytecode, production JAR과 smoke 전용 class 분리, Compose model 검증
- Git HEAD, EDC 범위 worktree 상태, source digest, Docker image ID, raw stdout hash 기록
- clean-start·cleanup 결과와 source digest 전후 일치 여부 기록
- 기존 raw run 파일 덮어쓰기 거부

로컬 전송은 EDC 0.18.0의 legacy Data Plane signaling 호환 경로를 사용한다. production Data Plane Signaling(DPS) worker 구현으로 간주하지 않는다.

### 2.2 CaaS 제어면

- 관리자·tenant·DSaaS controller 권한 분리
- tenant와 Connector 목표 상태 수렴 API
- `desiredGeneration`과 request digest를 이용한 세대 fencing
- 같은 세대의 다른 요청과 이전 세대 요청을 `409`로 거부
- 과거 idempotency key의 정확한 재생 시 원응답 반환, side effect 재실행 금지
- dry-run manifest provisioner 제공, production 설정에서 해당 provisioner 사용 거부

CaaS는 Connector 배포 의도를 계산하고 검증한다. Kubernetes나 Compose에서 EDC를 실제 생성·갱신·삭제하는 provisioner는 아직 없다.

### 2.3 DSaaS 제어면

- dataspace·membership 상태와 4-eyes 승인 절차
- 승인 Registry와 필수 서비스 Registry의 schema·URI·digest·freshness 검증
- Registry 읽기·JSON·schema 오류의 `503` 매핑과 `Retry-After: 60` 반환
- 승인 산출물의 IRI·version·SHA 결합
- CaaS에 `desiredGeneration`을 전달하는 수렴 scheduler
- 종료 즉시 readiness 해제, 신규 관리 요청 거부, listener와 scheduler의 단일 종료 기한 적용
- 종료 중 CaaS 호출 취소 전파와 늦게 도착한 결과의 상태 commit 차단
- drain deadline 이후 진행 중이던 관리 요청의 파일 state commit 차단
- start·close 경합 시 listener와 scheduler 재기동 차단

Registry 신뢰 기준은 실행 설정에 고정한 SHA다. 승인 Registry 파일이나 digest가 바뀌면 설정을 함께 배포하고 process를 다시 시작해야 한다.

### 2.4 Bridge와 Provider transfer worker

- DNS 조회 결과 분류 후 검증된 IP를 Undici dispatcher에 고정
- 원래 hostname을 Host header와 TLS SNI에 유지
- DNS·요청·응답 읽기·retry 대기를 하나의 전체 deadline으로 제한
- 재시도 전 DNS 재검증과 private·loopback rebinding 차단
- provision·revoke 응답의 transfer identity, agreement, dataset, provisioning ID, resource digest 검증
- revoke receipt의 닫힌 schema와 `ABSENT` 상태를 요구하는 `404` 처리
- journal 본문과 metadata에 대한 HMAC 검증
- 종료·revoke 재생 시 제거된 provisioner를 불필요하게 조회하지 않는 복구 경로

Journal HMAC은 변조를 검출하지만 과거의 유효한 journal 전체를 되돌리는 rollback은 검출하지 못한다.

## 3. 검증 결과

| 검증 명령 | 결과 | 확인 범위 |
| --- | ---: | --- |
| `npm run test:unit` | `188/188` 통과 | 전체 단위 시험 |
| `npm run test:integration` | `57/57` 통과 | 전체 통합 시험 |
| `npm run test:dsaas` | `62/62` 통과 | 승인·Registry·수렴·종료 경합 |
| `npm run test:caas` | `23/23` 통과 | 권한·세대 fencing·idempotency |
| `npm run test:runtime` | `21/21` 통과 | HTTP deadline·DNS pinning·abort |
| `npm run test:transfer-runtime` | `29/29` 통과 | receipt·journal·복구 |
| `npm run test:edc` | `28/28` 통과 | topology·runner·evidence schema |
| `npm run edc:verify:runtime` | 통과 | Gradle build·Java 17·JAR 분리·Compose |
| `npm audit --omit=dev` | 취약점 `0`건 | npm production dependency |

이 결과는 현재 source의 코드 경로와 정적·격리 통합시험 결과다. Docker 기반 Catalog·계약·전송 수명주기의 최신 실행 증거를 대신하지 않는다.

## 4. EDC 실행 증거 상태

### 4.1 현재 판정

- **(상태)** `pending-rerun`
- **(사유)** 구현 commit을 기준으로 한 detached clean worktree smoke를 아직 실행하지 않음
- **(과거 기록)** recorder 도입 전 실행은 retrospective placeholder로만 보존
- **(사용 제한)** 과거 asset·agreement·transfer ID와 payload hash를 현재 source의 통과 증거로 인용하지 않음

구현 commit과 그 구현을 시험한 raw run을 같은 commit에 넣을 수는 없다. 먼저 구현을 commit한 뒤 해당 commit의 clean worktree에서 smoke를 실행하고, raw run과 상태 요약은 별도 증거 commit으로 기록한다.

### 4.2 재실행 절차

1. stage 범위·secret·실행 파일 mode·임시 산출물을 점검하고 구현 commit을 생성한다.
2. 구현 commit을 가리키는 detached worktree를 별도 경로에 만든다.
3. 해당 worktree에서 `npm ci`와 EDC 사전 검증을 실행한다.
4. `tools/edc/run-smoke.ps1 -RecordEvidence <raw-run-path>`로 clean-volume smoke를 실행한다.
5. raw run의 Git commit, clean-start·cleanup, source digest 전후 일치, image ID, stdout hash를 검증한다.
6. raw run과 상태 요약을 본 worktree에 반영하고 증거 commit을 생성한다.

통과 범위는 동일한 Eclipse EDC 0.18.0 구성 두 참여자 사이의 Catalog, 계약 협상, PULL, 종료, 종료 후 token 거부다. 서로 다른 DSP 구현 사이의 상호운용이나 DSP TCK 적합성은 별도 시험 대상이다.

## 5. 운영 차단 항목

### 5.1 배포와 상태 일관성

- **(실제 provisioner 부재)** CaaS production 설정에서 사용할 Kubernetes·Compose·EDC provisioner와 배포 후 상태 확인 절차 미구현
- **(단일 host 저장소)** CaaS·DSaaS 상태 저장소와 scheduler가 local file·단일 process 전제
- **(분산 제어 부재)** leader election, distributed lock, generation fencing을 집행할 공유 저장소, split-brain 시험 미구현
- **(idempotency 보존 정책 부재)** key TTL, tenant별 quota, ledger 압축·폐기·감사 보존 기준 미정

### 5.2 인증과 승인

- **(CaaS 인증 시제품)** static bearer token을 사용하며 발급·rotation·폐기·tenant별 credential 운영 절차 미구현
- **(외부 승인 연계 부재)** 기관 승인 시스템 adapter, 전자서명, 서명자 권한과 시각 검증 미구현
- **(Registry 갱신 제약)** config에 고정한 digest만 신뢰하며 동적 서명 검증·trust-anchor rotation 미구현, 변경 시 재시작 필요
- **(stable namespace 미승인)** 운영기관이 승인한 DNS, TLS 인증서, namespace 책임자와 폐기 정책 미확정

### 5.3 EDC와 DSP

- **(production DPS 부재)** legacy local Data Plane signaling만 검증했으며 운영용 DPS worker와 공개 전송 endpoint 미구현
- **(publication 수명주기 미검증)** EDC publication adapter를 live container의 생성·갱신·삭제 흐름에 연결한 시험 미실행
- **(이기종 증거 부재)** 다른 EDC 배포판·다른 DSP 구현과의 시험 및 공식 DSP TCK 결과 없음
- **(운영 경계 미구현)** 참여자별 DB 최소 권한, TLS, network policy, secret manager, backup·복구 시험 미완료

### 5.4 공급망과 감사 증거

- **(공급망 통제 미완료)** Node 설치 tree와 SPDX SBOM은 고정했으나 Maven transitive checksum lock, Maven·container SBOM, image 서명, 전체 dependency license inventory는 미작성
- **(journal rollback 방어 부재)** 유효한 과거 journal 재생을 막을 외부 monotonic counter, CAS 저장소 또는 append-only anchor 미구현

`npm audit --omit=dev`의 취약점 0건은 npm advisory 기준 결과다. Maven artifact, container base image, 배포 manifest와 운영 secret의 공급망 검증을 포함하지 않는다.

## 6. 다음 작업 순서

1. 구현 변경의 stage 범위와 실행 파일 mode를 확인하고 구현 commit을 만든다.
2. 구현 commit의 detached clean worktree에서 EDC clean-volume smoke를 실행한다.
3. recorder-bound raw run의 hash와 source 결합을 검증하고 증거 commit을 만든다.
4. 실제 CaaS provisioner와 공유 transaction store를 구현한 뒤 다중 instance 경합시험을 추가한다.
5. production DPS worker와 EDC publication adapter의 live 수명주기 시험을 추가한다.
6. 외부 승인 서명과 Registry trust-anchor 갱신 절차를 정한다.
7. stable namespace 승인 후 이기종 DSP 시험과 공식 TCK를 별도 증거로 등록한다.

## 7. 인계 판정

현재 상태는 `EDC 기반 로컬 수명주기와 CaaS·DSaaS 제어면의 구현 후보`다. 코드 시험은 통과했으나 구현 commit 기준 EDC smoke가 남아 있으므로 로컬 수명주기 통과도 최신 증거로 확정하지 않는다.

실 provisioner, 분산 상태 제어, 운영 인증·승인, production DPS, stable namespace, 공급망 통제가 없으므로 실운영 완료로 표기할 수 없다. 이기종 구현이나 DSP TCK를 실행하지 않았으므로 DSP 상호운용 완료로도 표기할 수 없다.
