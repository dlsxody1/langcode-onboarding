# 실습 1 — ASP.NET Core + EF Core CRUD API

**목표: "C# 공부했다"가 아니라 "만들어봤다"가 되는 것.**
하루면 충분하고, 이 하루가 입사 첫 주의 속도를 완전히 바꾼다.

> ⚠️ **이 실습 코드는 이 환경에서 실행 검증하지 않았다** (작성 시점에 로컬에 `dotnet` 이 없었다).
> 오타나 버전 차이로 컴파일 에러가 날 수 있다. **그건 문제가 아니라 실습의 일부다** —
> 에러 메시지를 읽고 고치는 것이 .NET 에 익숙해지는 가장 빠른 길이다.
> 막히면 Claude 에게 에러를 그대로 붙여넣어라.

---

---

## 📖 실행하지 않고 읽기만 할 경우

노트북이 느리거나 세팅할 시간이 없으면 **`reference/` 의 4개 파일을 이 순서로 읽는 것만으로도
대부분을 얻는다.** 300줄이 안 된다.

### 읽는 순서와 각 파일에서 볼 것

| 순서 | 파일 | 여기서 확인할 것 |
| --- | --- | --- |
| 1 | [`Domain.cs`](reference/Domain.cs) | 엔티티(class)와 DTO(record)가 **왜 따로 있는지**. `InternalMemo` 가 DTO 에 없는 것 |
| 2 | [`AppDbContext.cs`](reference/AppDbContext.cs) | `HasQueryFilter` 한 줄이 **모든 쿼리를 바꾸는 것** |
| 3 | [`PetService.cs`](reference/PetService.cs) | 업무 규칙 3개가 **서비스 계층에만** 있는 것. `AsNoTracking`, Projection |
| 4 | [`Program.cs`](reference/Program.cs) | DI 등록 / 미들웨어 / 엔드포인트 **세 블록의 역할이 다른 것** |

### 요청 하나가 코드를 통과하는 경로

`POST /api/pets` 에 `{"name":"코코","species":"dog","ownerId":"8f3a..."}` 를 보냈을 때.

```
① Program.cs  app.UseExceptionHandler(...)         ← try 블록을 연다
② Program.cs  pets.MapPost("/", async (CreatePetRequest req, IPetService svc, ...) => ...)
                  ↑ JSON 이 CreatePetRequest 로 역직렬화됨
                  ↑ IPetService 를 DI 컨테이너가 주입 (PetService 생성 → AppDbContext 생성)
③ PetService.CreateAsync()
     규칙 1: 보호자 존재 확인  → 없으면 NotFoundException
     규칙 2: 생년월일 미래 검사 → DomainValidationException
     규칙 3: 이름 중복 검사    → ConflictException
     db.Pets.Add(pet)          ← 메모리에만
     db.SaveChangesAsync()     ← 여기서 INSERT (트랜잭션 자동)
④ Program.cs  Results.Created($"/api/pets/{pet.Id}", pet)   ← 201 + Location 헤더
⑤ 미들웨어를 역순으로 통과하며 응답
⑥ DI 컨테이너가 Scoped 객체 정리 → AppDbContext.Dispose()
```

**③에서 던진 예외가 ①에서 상태코드로 바뀐다.** 이 왕복이 이 실습의 핵심 구조다.
서비스는 HTTP 를 모르고(`404` 라는 숫자가 `PetService.cs` 에 없다),
컨트롤러는 업무 규칙을 모른다(`Program.cs` 에 "중복 이름 금지"가 없다).

### 각 경우에 실제로 나가는 응답

| 요청 | 상태 | 응답 본문 | 만드는 곳 |
| --- | --- | --- | --- |
| 정상 생성 | `201` | `{"id":"...","name":"코코",...}` + `Location: /api/pets/...` | `Results.Created` |
| 이름 중복 | `409` | `{"status":409,"title":"충돌이 발생했습니다","detail":"'코코' 은(는) 이미 등록된 이름입니다.","traceId":"..."}` | `ConflictException` → 핸들러 |
| 없는 보호자 | `404` | `{"status":404,"title":"찾을 수 없습니다","detail":"보호자 8f3a... 를 찾을 수 없습니다."}` | `NotFoundException` |
| 생년월일 미래 | `400` | `{"status":400,"title":"입력이 올바르지 않습니다","detail":"생년월일이 미래입니다."}` | `DomainValidationException` |
| `name` 빈 문자열 | `400` | `{"errors":{"Name":["The field Name must be a string with a minimum length of 1..."]}}` | **DataAnnotations 자동 검증** |
| 조회 실패 | `404` | (본문 없음) | `Results.NotFound()` |
| 삭제 성공 | `204` | (본문 없음) | `Results.NoContent()` |
| 예상 못 한 예외 | `500` | `{"status":500,"title":"서버 오류","detail":null,"traceId":"0HN7..."}` | `_ =>` 분기 |

**마지막 줄의 `"detail": null` 을 주목해라.** 500 에서만 detail 을 비운다.
`ex.Message` 를 그대로 내보내면 연결 문자열이나 내부 경로가 샐 수 있어서,
`traceId` 만 주고 실제 내용은 서버 로그에서 찾게 한다. *(`Program.cs` 의 주석 참고)*

**`name` 빈 문자열만 응답 형태가 다른 것**도 포인트다. 이건 내 코드가 아니라
`[Required, StringLength(50, MinimumLength = 1)]` 어트리뷰트를 보고 **프레임워크가 만든** 응답이다.
형식 검증(DTO 어트리뷰트)과 업무 규칙 검증(서비스)이 다른 층에 있다는 뜻이다.

### 읽고 나서 스스로 답해보기

1. `PetService.cs` 어디에도 `404` 라는 숫자가 없다. 그런데 404 가 나간다. 어떻게?
2. `AppDbContext.cs` 의 `HasQueryFilter(p => !p.IsDeleted)` 한 줄이 없으면 무슨 일이 생기나?
3. `DeleteAsync` 에서 `pet.IsDeleted = true` 만 하고 `db.Update(pet)` 를 안 부른다. 왜 저장되나?
4. `CreatePetRequest` 에 `Id` 필드를 추가하면 어떤 공격이 가능해지나?
5. `ListAsync` 의 `Select(...)` 를 `Include(p => p.Owner)` 로 바꾸면 SQL 이 어떻게 달라지나?
   *(→ `02-csharp-dotnet/03-ef-core.md` 3-2절 ②와 ③ 비교)*

> 이 5개에 답할 수 있으면 **실행한 것과 거의 같은 값을 얻은 것이다.**
> 나머지(아래 1\~5절)는 손으로 해볼 때의 안내다.

---

## 0. 준비

> 💡 **이 실습은 집 윈도우에서 하는 걸 권한다.** .NET 은 윈도우가 1급 시민이고,
> Visual Studio 2022 를 쓰면 디버거·EF 도구·SQL 뷰어가 전부 통합돼 있다.
> 맥북 초기화를 기다릴 이유가 없다.

**Windows (PowerShell)**

```powershell
winget install Microsoft.DotNet.SDK.9
# 새 터미널을 열고
dotnet --version                          # 9.x 이상
dotnet tool install --global dotnet-ef
```

**macOS**

```bash
brew install --cask dotnet-sdk
dotnet --version                          # 9.x 이상
dotnet tool install --global dotnet-ef
```

`dotnet ef` 가 "명령을 찾을 수 없다"고 나오면 PATH 문제다.
Windows 는 `%USERPROFILE%\.dotnet\tools`, macOS 는 `~/.dotnet/tools` 를 PATH 에 추가한다.

**DB 는 SQLite 를 쓴다.** Docker 도 Postgres 도 필요 없다. 파일 하나로 끝난다.
(회사는 PostgreSQL/MSSQL 을 쓰지만, EF Core 코드는 연결 문자열만 다르고 거의 같다)

---

## 1. 프로젝트 만들기

```bash
mkdir -p ~/petclinic && cd ~/petclinic
dotnet new webapi -n PetClinic.Api
cd PetClinic.Api

dotnet add package Microsoft.EntityFrameworkCore.Sqlite
dotnet add package Microsoft.EntityFrameworkCore.Design

dotnet run       # http://localhost:5xxx/openapi/v1.json 이 뜨면 성공
```

포트는 `Properties/launchSettings.json` 에 있다. 아래에서는 `5000` 이라고 가정한다.

---

## 2. 코드 작성

`reference/` 폴더의 파일들을 프로젝트에 복사하거나, 보면서 직접 쳐라.
**직접 치는 걸 권한다.** IDE 자동완성이 뜨는 걸 보는 것 자체가 학습이다.

| 파일 | 내용 | 관련 문서 |
| --- | --- | --- |
| `Domain.cs` | 엔티티 (Pet, Owner) + DTO (record) | `02-csharp-dotnet/01` 의 record |
| `AppDbContext.cs` | DbContext, Fluent API 매핑, 글로벌 쿼리 필터 | `02-csharp-dotnet/03` |
| `PetService.cs` | 업무 규칙 + 커스텀 예외 | `01-backend-basics/02` |
| `Program.cs` | DI 등록 + 미들웨어 + 엔드포인트 | `01-backend-basics/01` |

복사 후:

```bash
dotnet build                                  # 컴파일 = 타입 검증
dotnet ef migrations add InitialCreate        # 마이그레이션 생성
dotnet ef migrations script                   # 어떤 SQL 이 나가는지 눈으로 확인 ← 습관을 들여라
dotnet ef database update                     # petclinic.db 파일 생성
dotnet watch run                              # 핫 리로드로 실행
```

---

## 3. 동작 확인

가장 쉬운 방법은 **브라우저로 `http://localhost:5000/openapi/v1.json`** 을 열거나,
Visual Studio 의 `.http` 파일 / VS Code 의 REST Client 확장을 쓰는 것이다.
CLI 로 하려면 아래를 쓴다.

### Windows (PowerShell)

PowerShell 에서 `curl` 은 `Invoke-WebRequest` 의 별칭이라 옵션이 다르다.
**`curl.exe`** 로 명시하거나, 아래처럼 PowerShell 네이티브 방식을 쓴다.

```powershell
$BASE = "http://localhost:5000"

# 보호자 생성
$owner = Invoke-RestMethod -Uri "$BASE/api/owners" -Method Post -ContentType 'application/json' `
  -Body '{"name":"김철수","phone":"010-1234-5678"}'
$owner

# 펫 생성 (201 확인)
$body = @{ name="코코"; species="dog"; birthDate="2022-03-01"; ownerId=$owner.id } | ConvertTo-Json
Invoke-WebRequest -Uri "$BASE/api/pets" -Method Post -ContentType 'application/json' -Body $body |
  Select-Object StatusCode, Headers

# 목록
Invoke-RestMethod -Uri "$BASE/api/pets?page=1&size=10" | ConvertTo-Json -Depth 5

# 중복 생성 -> 409
try { Invoke-RestMethod -Uri "$BASE/api/pets" -Method Post -ContentType 'application/json' -Body $body }
catch { $_.Exception.Response.StatusCode }        # Conflict

# 검증 실패 -> 400
try { Invoke-RestMethod -Uri "$BASE/api/pets" -Method Post -ContentType 'application/json' `
        -Body '{"name":"","species":"dog"}' }
catch { $_.Exception.Response.StatusCode }        # BadRequest

# 없는 것 -> 404
try { Invoke-RestMethod -Uri "$BASE/api/pets/00000000-0000-0000-0000-000000000000" }
catch { $_.Exception.Response.StatusCode }        # NotFound
```

> PowerShell 은 4xx 를 예외로 던진다. 그래서 `try/catch` 가 필요하다.
> 상태코드를 편하게 보려면 `curl.exe -i ...` 쪽이 낫다.

### macOS / Linux / Git Bash

```bash
BASE=http://localhost:5000

# 보호자 생성
curl -s -X POST $BASE/api/owners -H 'Content-Type: application/json' \
  -d '{"name":"김철수","phone":"010-1234-5678"}' | tee /tmp/owner.json

OWNER=$(python3 -c "import json;print(json.load(open('/tmp/owner.json'))['id'])")

# 펫 생성 (201 + Location 헤더 확인)
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d "{\"name\":\"코코\",\"species\":\"dog\",\"birthDate\":\"2022-03-01\",\"ownerId\":\"$OWNER\"}"

# 목록 (페이지네이션)
curl -s "$BASE/api/pets?page=1&size=10" | python3 -m json.tool

# 중복 생성 → 409 Conflict
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d "{\"name\":\"코코\",\"species\":\"dog\",\"birthDate\":\"2022-03-01\",\"ownerId\":\"$OWNER\"}"

# 검증 실패 → 400 + 필드별 에러
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d '{"name":"","species":"dog"}'

# 없는 것 → 404
curl -i $BASE/api/pets/00000000-0000-0000-0000-000000000000

# 미래 생년월일 → 400 (업무 규칙 검증)
curl -i -X POST $BASE/api/pets -H 'Content-Type: application/json' \
  -d "{\"name\":\"미래\",\"species\":\"cat\",\"birthDate\":\"2030-01-01\",\"ownerId\":\"$OWNER\"}"
```

**상태코드를 하나하나 눈으로 확인해라.** 201/400/404/409 를 코드가 어디서 만드는지 찾아보는 게 핵심이다.

## 4. 반드시 해볼 것 — 여기가 진짜 실습

### ① SQL 을 눈으로 본다

`Program.cs` 에 이미 로깅이 켜져 있다. 목록 API 를 한 번 호출하고 콘솔을 봐라.

```
info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand ... SELECT "p"."Id", "p"."Name", ... FROM "Pets" AS "p" ...
```

**LINQ 가 SQL 로 번역되는 걸 직접 보는 것.** 이게 EF Core 를 이해하는 유일한 방법이다.

### ② N+1 을 직접 만들어 본다

`PetService.ListAsync` 의 Projection 을 이렇게 바꿔라.

```csharp
// 바꾸기 전 (좋은 것)
.Select(p => new PetDto(p.Id, p.Name, p.Species, p.BirthDate, p.Owner.Name))

// 바꾼 후 (N+1 을 만든다)
var pets = await query.ToListAsync(ct);
var dtos = new List<PetDto>();
foreach (var p in pets)
{
    var owner = await db.Owners.FindAsync([p.OwnerId], ct);   // ← 마리마다 쿼리
    dtos.Add(new PetDto(p.Id, p.Name, p.Species, p.BirthDate, owner!.Name));
}
```

펫을 20마리쯤 만들어 두고 목록을 호출하면, **콘솔에 SELECT 가 21번** 찍힌다.
이걸 한 번 보고 나면 N+1 을 절대 잊지 않는다.

### ③ `AsNoTracking()` 을 빼본다

목록 조회에서 빼고, 그 다음 `SaveChangesAsync()` 를 부르는 코드를 넣어보면
의도치 않은 UPDATE 가 나가는 걸 만들 수 있다.

### ④ 글로벌 쿼리 필터를 확인한다

`AppDbContext` 에 `HasQueryFilter(p => !p.IsDeleted)` 가 있다.
소프트 삭제된 펫이 목록에 안 나오는지, 그리고 **SQL 에 `WHERE NOT IsDeleted` 가 자동으로 붙는지** 확인해라.
`IgnoreQueryFilters()` 로 우회할 수 있다는 것도 확인.

> 멀티테넌시의 `tenant_id` 필터가 정확히 이 메커니즘이다.

### ⑤ 마이그레이션을 하나 더 만들어 본다

`Pet` 에 `public string? Memo { get; set; }` 를 추가하고:

```bash
dotnet ef migrations add AddPetMemo
dotnet ef migrations script AddPetMemo      # 이전 마이그레이션 이후의 SQL 만
dotnet ef database update
```

생성된 마이그레이션 파일의 `Up()` / `Down()` 을 읽어봐라.

### ⑥ 테스트를 붙인다

```bash
cd ~/petclinic
dotnet new xunit -n PetClinic.Tests
cd PetClinic.Tests
dotnet add reference ../PetClinic.Api
dotnet add package Microsoft.AspNetCore.Mvc.Testing
dotnet add package Microsoft.EntityFrameworkCore.InMemory
dotnet test
```

`reference/PetApiTests.cs` 참고. `WebApplicationFactory<Program>` 으로 **앱 전체를 메모리에 띄워
실제 HTTP 요청을 보내는 테스트**를 해본다. 프론트로 치면 E2E 신뢰도를 단위 테스트 속도로 얻는 것.

---

## 5. 추가 과제 (여유 있으면)

| 난이도 | 과제 |
| --- | --- |
| ★ | `PUT /api/pets/{id}` 수정 엔드포인트 추가 |
| ★ | 검색 필터 추가 (`?species=dog&q=코코`) — `IQueryable` 에 조건을 쌓는 연습 |
| ★★ | 커서 기반 페이지네이션으로 바꾸기 |
| ★★ | `RowVersion` 으로 낙관적 동시성 → `DbUpdateConcurrencyException` → 409 |
| ★★ | `X-Tenant-Id` 헤더를 읽는 미들웨어 + `tenant_id` 글로벌 쿼리 필터 |
| ★★★ | SQLite → PostgreSQL 로 교체 (`Npgsql.EntityFrameworkCore.PostgreSQL`, docker 로 DB 기동) |
| ★★★ | 오래 걸리는 작업 API — `202 Accepted` + 잡 상태 폴링 (`01-backend-basics/05`) |
| ★★★ | SSE 엔드포인트 — 1초에 한 글자씩 흘려보내기 (`05-realtime-ui/01`) |

마지막 두 개는 **랭코드에서 실제로 할 일과 가장 가깝다.** 시간이 있으면 여기까지 가라.

---

## 6. 끝나고 스스로 답해보기

1. `builder.Services.AddScoped` 와 `AddSingleton` 을 바꾸면 어디서 터지나?
2. `Include` 와 `Select` 중 뭘 썼고, SQL 이 어떻게 달랐나?
3. 409 를 만드는 코드는 어느 계층에 있나? 왜 거기인가?
4. `dotnet ef migrations script` 로 본 SQL 에서 인덱스가 어디에 생겼나?
5. 마이그레이션을 되돌리려면? 되돌릴 수 없는 마이그레이션은 어떤 것인가?
