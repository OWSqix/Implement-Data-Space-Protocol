# 메타데이터·정책 프로필

작성일: 2026-07-11  
작성 기준: 2026-07-12  
상태: Metadata Working Draft 구현·Policy Draft

## 1. 목적과 범위

이 문서는 통합채널과 원천 플랫폼의 metadata를 canonical model로 정규화하고 DSP Catalog에 투영하는 규칙을 정의한다.

Metadata 계층은 [응용 프로파일 1.0.0-rc.1](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/index.md)로 구현했다. 운영 URI, 실제 레코드 mapping과 기관 승인이 남아 있어 Working Draft로 관리한다. Policy와 DSP projection 부분은 설계 초안이다.

- **(시정 근거: B-06)** 현행 적용판이 RC.1이므로 cardinality·datatype과 실행 범위는 RC.1 requirement ledger·SHACL을 정본으로 판정하고 이전판은 이 문서의 적용 기준에서 제외한다.

- **(규격)** DCAT 3은 Dataset, Distribution과 DataService의 공통 의미를 제공한다.
- **(프로젝트 결정)** 국토교통 canonical field, Passport와 validation Gate는 이 프로젝트에서 정의한다.
- **(구현)** Connector 제품 객체와 private source binding은 선택한 제품 version에 맞춰 매핑한다.

## 2. 모델 경계

```text
플랫폼·원천 record
  -> hosted·brokered·index-only·unknown 판정 + Offering eligibility
  -> canonical metadata + Data Product Passport
    -> DSP/DCAT Dataset, Distribution, DataService
    -> Connector public Catalog model

원천 endpoint·credential
  -> implementation-specific private source binding + Secret Store

license·제공조건
  -> dct:license/dct:rights/dct:accessRights
  -> ODRL Offer + enforcement configuration
```

Dataset은 논리적 데이터 제품이고 Distribution은 실제 제공형태다.
하나의 Dataset이 REST JSON, 웹 피처 서비스(Web Feature Service, WFS)와 쉼표로 구분된 값(Comma-Separated Values, CSV) snapshot을 함께 제공할 수 있다.
이 경우 제공형태마다 Distribution을 하나씩 만들어 모두 세 개로 등록한다.

Canonical model은 `discovery 노출 가능`, `DSP Catalog 적격`과 `전송 가능`을 서로 다른 상태로 관리한다.

- 포털·DCAT discovery 노출 승인은 DSP Catalog 적격성을 의미하지 않는다.
- Offer·Distribution·DataService 조건이 없으면 DSP Catalog Dataset과 전송용 Offer를 만들지 않는다.
- DSP Catalog 적격성이 없으면 private source binding도 활성화하지 않는다.
- 제한 데이터는 적법한 대행기관의 재제공 권한이 확인되지 않으면 원 보유기관을 Offering Provider로 기록한다.
- 플랫폼이 적법한 `hosted` 또는 `brokered` 역할을 맡으면 플랫폼 Participant가 Offering Provider가 될 수 있다.
- 원 보유기관과 Offering Provider는 별도 field로 유지한다.

`platformRecordRole`은 Dataset과 delivery path별로 `hosted`, `brokered`, `index-only`, `unknown` 중 하나만 가진다. 플랫폼 전체에는 서로 다른 역할의 경로가 함께 있을 수 있다.

## 3. 식별자

### 3.1 원칙

- 원천 record ID와 source system ID를 모두 보존한다.
- source ID가 재사용되거나 변경될 가능성을 기록한다.
- Dataset, Distribution, DataService와 Provider는 서로 다른 안정 식별자를 사용한다.
- 생산 URI는 국토교통 거버넌스가 소유하는 HTTPS namespace로 발급한다.
- PoC에서 임시 통합 자원 이름(Uniform Resource Name, URN)을 사용하더라도 production URI로의 mapping을 유지한다.

### 3.2 PoC 후보

```text
urn:kr:molit-dataspace:dataset:{source-system}:{source-id}
urn:kr:molit-dataspace:distribution:{source-system}:{source-id}:{access-profile}
urn:kr:molit-dataspace:service:{provider}:{service-id}
urn:kr:molit-dataspace:participant:{organization-id}
```

이 namespace는 미승인 초안이며 외부 장기 식별자로 공개하지 않는다.

## 4. 연계·운영 canonical 목표 metadata

이 표는 Platform Bridge와 운영 Catalog의 목표 모델이다. MOLIT DCAT-AP 1.0.0-rc.1의 현행 규범표가 아니다.

RC.1 cardinality와 datatype은 release의 requirement ledger와 SHACL을 정본으로 삼는다. 명세·원장·shape·fixture는 하나의 release 계약으로서 같은 변경에서 함께 갱신하며 불일치 때 어느 하나를 임의로 우선하지 않는다.

- **(시정 근거: C1-02)** RC.1 `index.md`가 문서와 machine artifact의 임의 우선순위를 금지하고 명세·원장·shape·fixture의 동시 갱신을 요구하므로 이 release 계약을 정본 관계로 채택한다.

| 구분 | 필드 | 조건 | 검증 규칙 |
| --- | --- | --- | --- |
| 식별 | `@id`, `dct:identifier` | 필수 | 안정·고유, 원천 ID 추적 가능 |
| 설명 | `dct:title`, `dct:description` | 필수 | 사람이 이해할 수 있는 한국어 설명 |
| 발행책임 | `dct:publisher` | 필수 | source publisher와 organization registry 연결; 계약권한 증거로 대체 사용 금지 |
| 원 보유기관 | canonical `originDataHolderId` | 필수 | 데이터 생성·보유와 법적 제공판단 주체 |
| 플랫폼 역할 | canonical `platformRecordRole` | 필수 | hosted·brokered·index-only·unknown과 판정근거 |
| Offering Provider | canonical `providerParticipantId` | DSP Catalog 필수 | Offer·Agreement의 Provider Participant와 권한 증거 연결 |
| 운영책임 | canonical `connectorOperatorId`, `deliveryOperatorId` | DSP Catalog 필수 | Connector와 실제 전달 운영자를 구분 |
| 분류 | `dcat:theme`, `dcat:keyword` | 필수 | 승인된 국토교통 taxonomy 사용 |
| 발행·수정 | `dct:issued`, `dct:modified` | 목표: 필수. RC.1: `modified` 필수, `issued` 선택 | 목표 운영모델은 dateTime timezone을 요구한다. RC.1은 `xsd:date`·`xsd:dateTime`을 허용하며 timezone을 강제하지 않으므로 이 항목을 RC.1 적합성 주장에 사용하지 않음 |
| 갱신 | `dct:accrualPeriodicity` | 조건부 필수 | source update와 Catalog sync를 구분 |
| 시간범위 | `dct:temporal` | 시계열 필수 | 시작·종료, open interval 허용 규칙 명시 |
| 공간범위 | `dct:spatial` | 공개 가능한 공간자료 필수 | 행정구역 또는 geometry·BBOX; `withheld` 공개 projection에는 위치 자체를 넣지 않음 |
| 공간해상도 | `dcat:spatialResolutionInMeters`, `geodcatap:spatialResolutionAsText`, 원천 축척분모 | raster·정밀 공간자료 | 실제 지상해상도가 확인된 때만 미터 값을 기록. `1:n` 대표축척은 분모와 원문을 보존하고 미터로 자동 환산하지 않음 |
| 시간해상도 | `dcat:temporalResolution` | 관측자료 | ISO 8601 duration |
| license | `dct:license` | 조건부 필수 | 승인된 LicenseDocument URI만 사용 |
| 권리문구 | `dct:rights` | license URI가 없거나 추가 권리조건이 있을 때 | 일반 rights statement를 `dct:license`로 직렬화하지 않음 |
| 접근등급 | `dct:accessRights` | 필수 | 문자열 enum을 `PUBLIC`·`RESTRICTED`·`NON_PUBLIC` RightsStatement IRI로 변환 |
| 제공형태 | `dcat:distribution` | DSP Catalog 필수 | 적어도 하나의 승인 Distribution, 각 Distribution에 DSP `accessService` 하나 연결 |
| 접근서비스 | `dcat:accessService`, DataService `dcat:endpointURL` | DSP Catalog 필수 | Provider의 Negotiation·Transfer base endpoint, Catalog가 제공된 DSP version과 일치 |
| landing page | `dcat:landingPage` | 권장 | 원천 또는 통합 채널 상세페이지 |
| 버전 | `dcat:version` | versioned 데이터 | source version과 snapshot version 구분 |
| 계보 | `dct:provenance` | 변환 데이터 필수 | 원천·변환·검증 기록 연결 |

### 4.1 현행 통합 채널 Mapping

[로그인 후 정제 근거](../../evidence/authenticated-exploration/metadata-field-matrix.md)에서 대표 공개 상세와 Open API 문서 field를 비교했다.

| 현행 group | canonical 사용 | Gate |
| --- | --- | --- |
| `resource` | 식별·설명·권리·날짜의 초기 mapping | code와 datatype 검증 |
| `agent` | source organization 후보 | Provider 계약권한을 별도 증명 |
| `system` | source system·provenance | public landing URL과 private endpoint 분리 |
| `dataset` | temporal·spatial·갱신 metadata | CRS·축·단위와 실제 값 완전성 검증 |
| `distributions` | 제공형태 후보 | 비어 있으면 Offer 생성 금지 |
| `metaData` | schema·lineage 후보 | table·column 공개범위 승인 |

내부 상세 endpoint의 field가 DCAT와 유사해도 공식 export 계약과 안정성을 보장하지 않는다. 분석센터 read API는 별도 identifier, Distribution, spatial, delta·delete 정보가 확인될 때까지 보조 source 후보로만 사용한다.

### 4.2 외부 profile 정렬

국토교통 profile은 자체 필수 필드와 별도로 다음 외부 profile과의 crosswalk를 산출물로 관리한다. crosswalk는 필드 대응, cardinality 차이와 미대응 필드를 기록하며 profile 승인 전에는 초안으로 둔다.

용어의 경위 정본은 [데이터 스페이스 개념 감사](../01-research/dataspace-concept-audit.md)에 두며, 대표 표기의 등록·승격은 `report-style.config.json`의 `terminology`를 따른다. 이는 이 절의 필드 crosswalk와 별도 체계다.

| 대상 | 용도 | 상태 |
| --- | --- | --- |
| DCAT-AP 3.0.1 | 공통 카탈로그 제약 | RC.1 규범 기반·원본 SHACL 고정 |
| GeoDCAT-AP 3.1.0 | 공간정보 카탈로그 교환 | RC.1 공간 profile의 blocking SHACL |
| mobilityDCAT-AP 1.1.0 | 유럽 NAP·모빌리티 포털 교환; MDS·Mobilithek 연계 참조 | SHACL 미병합, Transport Mode 1.0.0 어휘만 재사용. Profile version·경계는 `CT-SEM-001`에서 검사. 정합 검토 산출물은 class·property·cardinality·통제어 차이와 손실표. 근거: `C-062` |
| TTAK.OT-10.1406 DCAT-AP-KR | 국내 데이터 포털 교환 | DCAT-AP 2.1.0 기반. 정본 3.0.1 graph를 2.1 계열로 내보내는 하향 crosswalk와 class·property·cardinality·통제어 손실 원장 미구현. 근거: `C-074` |
| TTAK.KO-10.1422 | 국내 공간정보 포털 교환 | 원문 확보와 GeoDCAT-AP 3.1.0 차이 분석 필요. 근거: `C-074` |
| TTAK.KO-10.1510-Part3 | 디지털 국토정보 플랫폼 메타데이터 교환 | 2026-06-26 현행. 원문 기반 cardinality 분석 미완료. 근거: `C-069`, `C-070` |
| KS X ISO 19115-1·-2·-3 | 공간 원천 메타데이터 수집 | 개념모델, 획득 확장과 현행 XML ingest를 분리. 125개 manifest·offline XSD·Schematron smoke 구현, 승인 cache·KS 조항·왕복시험 대기. 근거: `C-064`, `C-068` |
| 국토지리정보원 메타데이터·품질 적용확인서 | 적용 대상 공간 제품의 국내 규정 준수 | 공개 RDF와 분리한 내부 compliance record 및 제품별 validator 필요 |
| 국가 데이터 카탈로그(국가데이터인프라) | 국내 범정부 카탈로그 연계 | NIA 원-윈도우 가이드 v1.0은 DCAT-AP 2.1 준용. 정본 3.0.1→2.1 하향 crosswalk, 손실 원장, 양방향 fixture와 비가역 항목 판정이 산출물. 근거: `C-083` |

프로젝트 metadata 정본 3.0.1([ADR-0005](../adr/0005-dcat-ap-3-profile-baseline.md))은 불변이다. 하향 crosswalk는 원-윈도우 연계 산출물이며 정본 version을 2.1로 낮추지 않는다.

## 5. Distribution 프로필

DSP 2025-1 wire schema에서 Distribution `accessService`는 DataService 객체 또는 그 ID 하나다.

이 단일 cardinality는 2025-1 wire schema에 한정된 제약이다. 스펙 main branch prose는 Distribution당 DataService를 `at least one`으로 서술한다. 차기 DSP version을 채택할 때 다시 검토한다. 근거: `C-058`.

- 여러 Provider endpoint나 접근 profile이 필요하면 Distribution을 분리한다.
- 각 Distribution에는 `accessService` 하나를 둔다.
- DataService의 `dcat:endpointURL`은 Offering Provider Connector의 Contract Negotiation·Transfer Process base endpoint를 가리킨다.
- `endpointURL`의 DSP version은 Catalog가 제공된 version과 일치해야 한다.
- 원천 REST API, file URL과 플랫폼 subscription API는 `endpointURL`로 복사하지 않는다.
- Catalog Broker는 upstream Provider endpoint를 자신의 endpoint로 바꾸지 않는다.
- Bridge 또는 CaaS Connector를 Provider endpoint로 사용하려면 해당 Participant의 제공·계약 권한 증거가 필요하다.

Transfer Request는 Distribution ID를 전송하지 않는다.

- Transfer Request는 `@context`, `@type`, `consumerPid`, `agreementId`, `format`과 `callbackAddress`를 포함한다.
- Push Transfer Request는 `dataAddress`를 추가로 포함한다.
- Transfer Start는 `@context`, `@type`, `providerPid`와 `consumerPid`를 포함한다.
- Pull Transfer Start는 `dataAddress`를 추가로 포함한다.
- `(Dataset ID, format)`은 승인된 transfer binding 하나로 resolve돼야 한다.
- 같은 조합이 여러 source binding으로 이어지면 validation 단계에서 등록을 거부한다.

아래 표의 private source binding은 Connector 내부에서 원천 API·파일·broker를 찾는 구현 객체다. push Transfer Request 또는 pull Transfer Start에서 교환되는 DSP `dataAddress`와 다른 개념이며 public Catalog에 노출하지 않는다.

| 프로필 | metadata | 비공개 source binding |
| --- | --- | --- |
| REST pull | media type, schema/OpenAPI, non-finite 여부, quota class | base URL, credential reference, allowed routes |
| File pull | media type, byte size, checksum, created/valid time | object key, signed URL issuer, expiry |
| File push | media type, checksum algorithm, encryption | provider source와 consumer sink requirements |
| WFS/OGC Features | conformance, collection/layer, CRS, bbox, limit | source capabilities URL, credential, allowed layer |
| 웹 맵 서비스(Web Map Service, WMS)·웹 맵 타일 서비스(Web Map Tile Service, WMTS) | layer, style, CRS, image type, zoom/scale | source endpoint, key, allowed operations |
| Stream | schema subject/version, ordering, retention, QoS | broker, topic template, 접근제어목록(Access Control List, ACL) provisioner |
| Secure analysis | runtime, allowed operation, output policy | execution environment, dataset mount, result reviewer |

`dcat:mediaType`은 인터넷 할당 번호 관리기관(Internet Assigned Numbers Authority, IANA)의 media type을 식별하는 URI를 사용한다. 예시는 `https://www.iana.org/assignments/media-types/application/json`이다.

- 원천의 `application/json`, `text/csv` 문자열은 canonical `dct:format` 또는 로컬 필드에 보존한다.
- Mapper는 검증된 IANA URI가 있을 때 `dcat:mediaType`으로 변환한다.
- `dcat:mediaType`은 DSP Transfer Request의 `format`과 다른 값이다.
- DSP `format`은 선택한 Connector와 transport profile의 상호운용 규격을 확정한 뒤 고정한다.
- 근거는 `C-043`이다.

## 6. 국토교통 확장 필드

RC.1은 제안 namespace에 교통망 참조, 품질 상태와 공간 공개 정밀도 term을 정의했다. URI는 운영 승인 전이며 외부 장기 식별자로 사용할 수 없다.

다음 표에는 구현 term과 후속 canonical model 후보가 함께 있다. 실행 범위와 cardinality는 [RC.1 requirement ledger](../../profiles/molit-dcat-ap/releases/1.0.0-rc.1/requirements/profile-requirements.json)와 RC.1 SHACL을 기준으로 판정한다.

| 의미 | 적용 자산 | 예시 검증 |
| --- | --- | --- |
| CRS·축 순서 | 모든 공간정보 | 원천 CRS와 검색용 CRS84 geometry를 분리. 좌표 tuple은 CRS와 직렬화 규칙의 공식 축 순서를 따름. CRS84는 경도·위도, EPSG:5179는 northing·easting 순서로 별도 시험 |
| geometry type | feature 데이터 | Point·LineString·Polygon 등 허용목록 |
| 경계 상자(Bounding Box, BBOX)·관할 | 공간정보 | Dataset extent와 query 허용범위 구분 |
| 공간 정밀도 | raster·좌표 | 보안등급과 제공 가능한 정밀도 일치 |
| 관측시각·시간대 | 교통·센서 | UTC 또는 `Asia/Seoul`, source timestamp 의미 |
| 관측 간격·지연 | 실시간·시계열 | 수집 간격과 제공 latency를 별도 기록 |
| 단위·산식 | 속도·통행시간·교통량 | unit URI와 aggregation 방식 |
| 센서·지점 ID | 검지기·폐쇄회로 텔레비전(Closed-Circuit Television, CCTV)·관측소 | 발급기관, 안정성, 폐기 이력 |
| 표준 node/link version | 도로망·소통정보 | 배포일·version·변경이력 파일 |
| 품질상태·측정 | 적용 제품표준이 있는 공간정보 | 완전성·논리 일관성·위치·주제·시간 정확도의 측정 식별자, 평가방법, 값·단위, 합격 여부와 근거 제품사양을 함께 기록 |

## 7. Data Product Passport

Passport는 Catalog metadata보다 상세한 내부 승인·운영 문서다. 다음 항목을 포함한다.

- 원 보유기관, Publisher·steward, platform `hosted`·`brokered` 역할, Offering Provider
- 계약 당사자, Connector 운영자, Data Delivery 운영자, 비상 연락처
- 원천·Catalog·Distribution 식별자
- 법적 제공근거, license, 제3자 권리
- 공개등급, 허용 수신자·목적·지역·기간
- 재제공, 파생물, AI 학습, 국외처리 조건
- schema, 코드표와 version
- CRS, 단위와 시간대
- update, latency, 품질, 결측·오류 기준
- transform·filter·anonymization과 provenance
- cache, 보유, 삭제, backup 정책
- 법무·개인정보·공간정보·보안 승인 증거와 유효기간
- source·adapter SLO와 incident owner

### 7.1 필수 정책 필드

다음 이름은 내부 canonical field 후보이며 DCAT·ODRL 표준 용어로 주장하지 않는다. 실제 vocabulary URI를 승인하기 전에도 Passport에는 같은 의미를 빠짐없이 기록한다.

| 필드 의미 | 조건 | 판정 내용 |
| --- | --- | --- |
| `catalogVisibility` | 모든 자산 | public·qualified·internal·hidden 중 Catalog 노출 범위 |
| `dspCatalogEligible` | 모든 자산 | DSP Dataset 구조·권리 Gate 통과 여부와 차단사유 |
| `transferDecision` | 모든 자산 | approved·conditional·pending·denied와 판정일 |
| `originDataHolder` | 모든 자산 | 원 보유기관과 원천 업무부서 |
| `platformRecordRole` | 모든 자산 | hosted·brokered·index-only·unknown과 판정 evidence |
| `platformOperator` | 플랫폼 record | `hosted`·`brokered`·`index-only` 기능과 SLA 운영자 |
| `offeringProviderParticipant` | DSP Catalog 필수 | Offer와 Agreement의 Provider Participant |
| `connectorOperator` | DSP Catalog 필수 | Connector·CaaS 배포와 DSP endpoint 운영자 |
| `contractingParty` | DSP Catalog 필수 | machine Agreement와 법적 계약의 책임주체 |
| `deliveryOperator` | transferable 필수 | source·gateway·snapshot·stream 전달 운영자 |
| `providerAuthority` | transferable 필수 | owner·delegate·agent 구분과 제공·재제공 권한 증거 |
| `legalBasisRef` | transferable 필수 | 적용 법령, 제공 결정, 위임 또는 계약의 문서 식별자 |
| `rightsHolderAndLicense` | 모든 자산 | 저작권·제3자 권리자, license와 출처표시 조건 |
| `dataClassification` | 모든 자산 | 공개·공개제한·비공개와 개인정보·가명정보·공간정보 해당성의 분리 기록 |
| `allowedRecipient` | 제한 자산 필수 | 허용 기관유형, 자격과 검증 증거 |
| `allowedPurpose` | 제한 자산 필수 | 승인 목적과 목적 변경 절차 |
| `processingLocation` | 제한 자산 필수 | 실행·저장·백업·원격접근 국가와 국외처리 허용 여부 |
| `onwardTransfer` | transferable 필수 | 재제공·재위탁·재이전 허용 여부와 승인 절차 |
| `deliveryMode` | transferable 필수 | source link·proxy·file·stream·secure-analysis 중 승인 방식 |
| `platformLifecycleMode` | transferable 필수 | none·manual·token·entitlement·subscription·job 중 생성·회수 방식 |
| `retentionAndDeletion` | 제한 자산 필수 | 보유기한, 파기시점, backup 처리와 파기 증적 |
| `approvalEvidence` | 제한 자산 필수 | 법무·개인정보·공간정보·보안 승인 문서와 유효기간 |
| `reviewAt` | 모든 자산 | 법령·license·권한·품질 재검토 기한 |

`providerAuthority`가 대행·중개를 나타내면 Validation 단계에서 제공·계약·재제공 권한 증거를 검사한다.

- 증거가 없으면 포털·DCAT discovery index에 원천 링크만 남긴다.
- 증거가 없으면 DSP Catalog Dataset을 만들지 않는다.
- 해당 자산의 `transferDecision`은 `pending` 또는 `denied`로 둔다.
- 개인정보, 교통카드 데이터와 공개제한 공간정보는 자산·목적·수신자별 법무·보안 검토를 추가로 거친다.

템플릿은 [dataset-passport.md](../../templates/dataset-passport.md)에 있다.

## 8. 정책 등급

아래 표의 `negotiation 완료`는 확인 응답(Acknowledgement, ACK)까지 마친 다음 세 단계를 뜻한다.

- Contract Agreement Message와 ACK로 `AGREED`에 도달한다.
- Agreement Verification Message와 ACK로 `VERIFIED`에 도달한다.
- `FINALIZED` Event와 ACK로 `FINALIZED`에 도달한다.

| 정책 등급 | Catalog | 계약 | Data Plane | 전달 이후 |
| --- | --- | --- | --- | --- |
| Open | 전체 metadata와 기존 공개 URL | direct 경로는 없음; DSP Transfer는 negotiation 완료 필요 | 기존 공개 경로 유지, DSP 경로는 운영 quota·출처 metadata | 기존 license |
| Registered open | 전체 metadata와 원천 신청 경로 | negotiation 완료와 참가자 식별 | 원천 key/token, quota | 기존 license |
| Institutional restricted | 자격별 최소 metadata | 기관유형·목적·기간 | row·column·area filter | 계약·감사·파기 |
| Secure analysis | 존재·요약만 | 자격·목적·환경·승인 | 원천 통제환경의 원격 실행·결과 반출 | 결과물 조건·감사 |
| Excluded | 외부 미노출 | 없음 | 없음 | 내부 inventory만 |

Open 자산은 데이터 스페이스 가입을 기존 공개 경로의 선행조건으로 만들지 않는다.

- 기존 공개 URL의 direct 이용은 DSP 밖에서 계약 없이 유지한다.
- DSP Transfer Process로 제공하는 Open 자산은 Offer 선택과 negotiation 완료 절차를 따른다.
- Institutional restricted 자산은 파일 전달보다 proxy를 우선 평가한다.
- 개인 이동·가명정보와 공개제한 공간정보는 secure analysis 또는 compute-to-data를 우선 평가한다.

## 9. ODRL Profile 후보

다음 left operand는 국토교통 Profile 후보이며, URI·값·평가함수를 승인한 뒤 사용한다.

| 후보 의미 | 평가 입력 | 집행 시점 |
| --- | --- | --- |
| participant role | 검증된 기관 credential | Catalog·negotiation |
| declared purpose | 계약 요청과 승인 workflow | negotiation·transfer |
| jurisdiction | participant·execution environment | negotiation·transfer |
| contract expiry | Agreement 시간 | transfer·token issuance |
| security approval | 보안심사 credential·registry | Catalog·transfer |
| spatial area | Agreement와 request BBOX | Data Plane |
| max requests/bytes | 계약 quota | Data Plane |
| attribution | license obligation | Agreement·consumer evidence |
| deletion deadline | contract termination time | 사후 workflow·audit |
| no redistribution | contract term | 소비자 통제·법적 집행 |

다음 표는 D-09 조건 축과 기존 후보의 표현·집행 시점을 대조한 판정 기록이다. 위 표의 집행 시점 값은 변경하지 않는다.

| D-09 비교 축 | §9 대응 | 기존 집행 시점 | 판정 |
| --- | --- | --- | --- |
| 목적 | declared purpose | negotiation·transfer | 정합 — 기계집행 최소 집합 |
| 수신자 | participant role | Catalog·negotiation | 정합 — 기계집행 최소 집합 |
| 기간 | contract expiry | transfer·token issuance | 정합 — 기계집행 최소 집합 |
| 재제공 | no redistribution | 소비자 통제·법적 집행 | 불일치 — 표현 유지, 전달 후 기계집행 불가 |
| 보존 | deletion deadline | 사후 workflow·audit | 불일치 — 표현 유지, 전달 후 기계집행 불가 |
| 관할 — FR-POL-004, D-09 밖 | jurisdiction | negotiation·transfer | D-09 미포함; FR-POL-004(MUST) 표현 후보로 유지 |

D-09의 최소 기계집행 집합은 목적·수신자·기간과 참가 등급 연동이다. 각 축은 위 표의 기존 집행 시점을 따른다.

**재제공과 보존의 전달 후 기계집행은 불가하다.** 재제공·보존은 ODRL로 표현할 수 있으나 전달 뒤에는 계약, 당사자 증적·공통 감사 ID와 제재 절차를 결합한다. 표현 가능성을 기술적 통제 가능성으로 판정하지 않는다.

관할은 D-09 범위 밖이며 [FR-POL-004](requirements.md#4-기능-요구사항)와의 관계를 유지한다. `spatial area`와 `max requests/bytes`는 이미 Data Plane 집행으로 등록되어 추가 작업이 없다. FR-TRN-004의 method·row·column·BBOX·quota 요구는 변경하지 않는다.

정책어를 문자열로만 추가하지 않는다. 의미, datatype, operator, evaluation failure, 지원하지 않는 처리기의 동작을 Profile 문서에 정의한다.

ODRL 평가는 `transferDecision=approved|conditional`이고 `providerAuthority` 증거가 유효한 자산에만 적용한다. Offer나 Agreement가 `pending|denied` 판정을 허용으로 바꾸거나 법적 제공권한을 새로 만들 수 없다.

## 10. 공개 license와 Offer

- `dct:license`는 데이터의 법적 이용허락을 가리킨다.
- ODRL Offer는 특정 Dataset을 어떤 계약·접근조건으로 제공하는지 표현한다.
- API 호출량이나 endpoint token 조건을 데이터의 재사용권과 혼동하지 않는다.
- 출처표시 license라면 Offer의 duty가 license와 충돌하지 않게 한다.
- license가 제한 없음인데 Offer가 비영리만 허용하는 경우 validation error로 처리한다.
- 공개 데이터의 기존 공개 URL과 이용조건을 유지하고 DSP Distribution은 추가 접근 경로로만 제공한다.
- 제한 데이터는 원 보유기관을 Provider로 두며, 중개기관은 재제공 권한 증거가 있을 때만 Provider 또는 transfer proxy가 될 수 있다.

## 11. Connector 내부 투영

제품 독립적인 최소 투영은 다음과 같다.

```text
canonical Dataset, Distribution, DataService
  -> Connector public Catalog model

source location and credential reference
  -> private source address + Secret Store reference

visibility and contract conditions
  -> policy model and evaluation configuration

eligible Dataset + Offer + source binding
  -> product-specific registration model
```

EDC를 채택하면 배포 대상 version과 그 version의 Management API·source-resolution 확장점을 먼저 고정한다.

- 과거 handbook의 `Asset`·`DataAddress` 예제는 선택한 release의 고정 API로 간주하지 않는다.
- 다른 Connector를 채택하면 해당 제품 객체를 사용한다.
- 제품과 무관하게 public/private 경계와 export 가능한 canonical model을 유지한다.
- 근거는 `SRC-TECH-005`, `SRC-TECH-015`다.

## 12. Validation

RC.1 실행기는 DCAT-AP 3.0.1, GeoDCAT-AP 3.1.0과 프로젝트 자체 SHACL의 RDF 적합성을 검사한다. 이 결과는 TTAK.OT-10.1406, TTAK.KO-10.1422, TTAK.KO-10.1510-Part3, 국토지리정보원 기관표준 또는 제품별 품질규정의 적합성 판정을 대신하지 않는다.

Release lock과 fatal UTF-8을 확인한 뒤 exact mailbox·host, PII·credential, Core·Geo routing preflight를 통과한 graph에 SHACL을 적용한다. 검증 명령은 다음과 같다.

```bash
npm run profile:verify
npm run profile:verify:independent
npm run profile:validate:example
```

| 구분 | RC.1 구현 범위 | 상태 |
| --- | --- | --- |
| RDF 적합성 | DCAT-AP 3.0.1, 조건부 GeoDCAT-AP 3.1.0, 국토교통 필수·통제어 SHACL | 구현 |
| Profile 선택 | Catalogue·CatalogRecord marker 정확히 1개, canonical IRI, GeoDCAT 15개·GeoSPARQL 6 class/54 property·국토교통 공간 term routing | 구현 |
| Core coverage 예외 | `dcat:bbox`·`dcat:centroid`의 CRS 명시 WKT·GML literal은 Core 허용, 다른 Geo datatype 사용은 Geo 선택 | 구현 |
| Shape 무결성 | W3C SHACL-SHACL, artifact SHA-256, OGC GeoSPARQL 고정본과 routing term 대조, runtime remote import 금지 | 구현 |
| 공개 projection | exact mailbox·DNS host registry, 전화 전면 금지, IP literal·private binding·credential·PII·개인 유형·민감 query·과대 literal 검사 | 구현 |
| 판정 재현성 | artifact byte snapshot, profile bundle digest, validator source build digest와 report schema digest | 구현 |
| release 의존성 | 격리 `npm ci`의 152개 설치 package tree·153개 SPDX package SBOM, Jena 6.1.0·JRE 21 archive와 설치 tree digest | win32-x64 lane 구현 |
| 공간정보 | 허용 CRS, geometry literal CRS, 공개 수준, withheld와 geometry 동시 게시 금지 | 구현 |
| 실행 한도 | 입력 5 MiB·100,000 quad·subject-property 값 1,000개·보고서 500건 | 구현 |
| 독립 SHACL engine | pySHACL 0.40.0 재검증과 Apache Jena 6.1.0의 Core·Geo 13개 사례 구조 정규화 비교 | win32-x64 lane 구현; message·blank label은 비교 제외 |
| 국내 표준 적합성 | DCAT-AP-KR·국내 공간정보 DCAT·TTA 국토정보 metadata·국토지리정보원 적용확인서 | 원문 확보 및 validator 구현 전 |
| ISO 19115 XML | official artifact 125개 digest manifest와 offline XSD·Schematron smoke | 기술 lane 구현; 재배포 허가 또는 승인 private cache와 XML↔RDF round-trip 미확보 |
| RDF 직렬화 ingest | Turtle·RDF/XML·JSON-LD·N-Triples·N-Quads의 안전 ingest와 RDFC-1.0·Jena parser 비교 | 구현 |
| 권리·정책 충돌 | license와 ODRL Offer의 목적·영리·재제공 조건 비교 | 미구현 |
| 권한 registry | Provider·participant·asset·action·위임 증거, 유효기간·철회와 서명 receipt 판정 | resolver 구현; 기관 entry·trust anchor·production verifier 미확보 |
| Adapter·DSP | Distribution capability, DSP version, transfer binding 단일성 | Bridge v2 미구현 |
| 운영 상태 | source 수정·삭제·version 단조성, lifecycle provision·revoke | 미구현 |
| Passport 정책 | 역할·국외처리·보유·파기·승인 유효기간 검증 | schema·workflow 미구현 |

검증 실패 자산은 자동 공개하지 않고 quarantine queue로 보낸다.
