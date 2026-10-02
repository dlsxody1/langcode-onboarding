# 실습 1 — ASP.NET Core + EF Core CRUD API

**목표: "C# 공부했다"가 아니라 "만들어봤다"가 되는 것.**
하루면 충분하고 이 하루가 입사 첫 주의 속도를 완전히 바꾼다.

만드는 것은 동물병원의 보호자(Owner)와 펫(Pet)을 등록·조회·삭제하는 작은 API 다. 기능은 단순하지만 회사 코드에서 매일 만날 구조가 다 들어 있다. DI 로 서비스를 주입한다. 서비스가 업무 규칙을 검사해 예외를 던지고 한 곳에서 그 예외를 HTTP 상태코드로 바꾼다. EF Core 가 LINQ 를 SQL 로 번역한다.

> ⚠️ **이 실습 코드는 이 환경에서 실행 검증하지 않았다** (작성 시점에 로컬에 `dotnet` 이 없었다).
> 오타나 버전 차이로 컴파일 에러가 날 수 있다. **그건 문제가 아니라 실습의 일부다** —
> 에러 메시지를 읽고 고치는 것이 .NET 에 익숙해지는 가장 빠른 길이다.
> 막히면 Claude 에게 에러를 그대로 붙여넣어라. 자주 걸리는 지점은 [`reference/NOTES.md`](reference/NOTES.md) 에 모아 두었다.

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

읽기 전에 알아 둘 용어를 파일 순서대로 정리한다.

- **엔티티와 DTO** (`Domain.cs`): 엔티티 `Pet` 은 DB 테이블의 모양이고 DTO `PetDto` 는 API 가 주고받는 JSON 의 모양이다. 둘을 나누는 이유는 파일 주석에 세 가지로 적혀 있다. 내부 필드(`InternalMemo`)가 밖으로 새지 않게, `Pet.Owner.Pets...` 로 이어지는 순환 참조가 JSON 직렬화를 망가뜨리지 않게, DB 컬럼을 바꿔도 API 계약이 따라 바뀌지 않게 하려는 것이다. (→ `01-backend-basics/02-layers-and-di.md` 2절)
- **over-posting** (`Domain.cs` 의 `CreatePetRequest` 주석): 클라이언트가 요청 JSON 에 원래 보내면 안 되는 필드(`id`, `tenantId`, `isDeleted`)를 끼워 보내서 서버 값을 덮어쓰는 공격이다. 요청 DTO 에 그 필드가 아예 없으면 보낼 방법이 없다.
- **글로벌 쿼리 필터** (`AppDbContext.cs`): `HasQueryFilter(p => !p.IsDeleted)` 는 Pet 으로 나가는 모든 SELECT 에 `WHERE NOT IsDeleted` 를 자동으로 붙인다. 개발자가 매번 조건을 기억할 필요가 없다.
- **소프트 삭제** (`PetService.DeleteAsync`): 행을 DB 에서 지우지 않고 `IsDeleted = true` 표시만 하는 삭제다. 위 필터 덕분에 조회에서는 사라진 것처럼 보인다.
- **AsNoTracking 과 Projection** (`PetService.cs`): `AsNoTracking()` 은 조회한 엔티티를 EF 가 기억하지 않게 한다. Projection 은 `.Select(p => new PetDto(...))` 로 필요한 컬럼만 DTO 로 바로 받는 것이다. (→ `02-csharp-dotnet/03-ef-core.md` 2절, 3절)
- **Scoped** (`Program.cs`): `AddScoped` 로 등록한 객체는 HTTP 요청 하나에 하나씩 만들어지고 요청이 끝나면 버려진다. `AppDbContext` 와 `PetService` 가 이 수명이다.

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

①의 "try 블록을 연다"는 비유다. `UseExceptionHandler` 는 파이프라인 맨 앞에 있어서 그 뒤 어디서 예외가 나든 거슬러 올라와 여기서 잡힌다. 그러면 `Program.cs` 의 `ex switch { ... }` 가 예외 타입을 보고 상태코드를 고른다. JS 로 치면 Express 의 맨 마지막 에러 핸들러 `app.use((err, req, res, next) => ...)` 와 같은 자리다.

②의 **역직렬화**는 JSON 문자열을 C# 객체(`CreatePetRequest`)로 바꾸는 것이다. `JSON.parse` 후 타입 검사까지 한 번에 하는 셈이다. JSON 의 `ownerId` 와 C# 의 `OwnerId` 처럼 대소문자가 달라도 기본 설정이 맞춰 준다.

### 각 경우에 실제로 나가는 응답

| 요청 | 상태 | 응답 본문 | 만드는 곳 |
| --- | --- | --- | --- |
| 정상 생성 | `201` | `{"id":"...","name":"코코",...}` + `Location: /api/pets/...` | `Results.Created` |
| 이름 중복 | `409` | `{"status":409,"title":"충돌이 발생했습니다","detail":"'코코' 은(는) 이미 등록된 이름입니다.","traceId":"..."}` | `ConflictException` → 핸들러 |
| 없는 보호자 | `404` | `{"status":404,"title":"찾을 수 없습니다","detail":"보호자 8f3a... 를 찾을 수 없습니다."}` | `NotFoundException` |
| 생년월일 미래 | `400` | `{"status":400,"title":"입력이 올바르지 않습니다","detail":"생년월일이 미래입니다."}` | `DomainValidationException` |
| `name` 빈 문자열 | `400` | `{"errors":{"Name":["The Name field is required."]}}` (문구는 검증 방식·버전에 따라 다르다) | **DataAnnotations 자동 검증** |
| 조회 실패 | `404` | (본문 없음) | `Results.NotFound()` |
| 삭제 성공 | `204` | (본문 없음) | `Results.NoContent()` |
| 예상 못 한 예외 | `500` | `{"status":500,"title":"서버 오류","detail":null,"traceId":"0HN7..."}` | `_ =>` 분기 |

**마지막 줄의 `"detail": null` 을 주목해라.** 500 에서만 detail 을 비운다.
`ex.Message` 를 그대로 내보내면 연결 문자열이나 내부 경로가 샐 수 있어서,
`traceId` 만 주고 실제 내용은 서버 로그에서 찾게 한다. *(`Program.cs` 의 주석 참고)*

`traceId` 는 요청마다 붙는 고유 번호(`ctx.TraceIdentifier`)다. 같은 번호가 서버 로그의 `처리되지 않은 예외 {TraceId}` 줄에도 찍힌다. 사용자가 에러 화면의 이 번호를 알려 주면 개발자는 로그에서 그 번호로 검색해 스택트레이스를 찾는다. (→ `07-db-infra/04-observability.md` 3절)

**`name` 빈 문자열만 응답 형태가 다른 것**도 포인트다. 이건 내 코드가 아니라
`[Required, StringLength(50, MinimumLength = 1)]` 어트리뷰트를 보고 **프레임워크가 만든** 응답이다.
형식 검증(DTO 어트리뷰트)과 업무 규칙 검증(서비스)이 다른 층에 있다는 뜻이다.

빈 문자열은 `[Required]` 에서 먼저 걸린다. `Required` 는 `null` 뿐 아니라 `""` 도 "값 없음"으로 보기 때문이다. 이 줄이 실제로 400 이 되려면 Minimal API 에 검증이 켜져 있어야 한다. `.WithParameterValidation()` 이 컴파일되지 않거나 빈 이름이 그대로 201 로 저장되면 `reference/NOTES.md` 첫 절을 본다.

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

`dotnet-ef` 는 마이그레이션을 만들고 적용하는 EF Core 명령줄 도구다. SDK 에 들어 있지 않아서 `npm i -g` 처럼 전역 도구로 따로 설치한다.

**DB 는 SQLite 를 쓴다.** Docker 도 Postgres 도 필요 없다. 파일 하나로 끝난다.
(회사는 PostgreSQL/MSSQL 을 쓰지만 EF Core 코드는 연결 문자열만 다르고 거의 같다)

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

설치한 두 패키지의 역할은 다르다. `Microsoft.EntityFrameworkCore.Sqlite` 는 EF Core 가 SQLite 와 대화하게 해 주는 **프로바이더**다. PostgreSQL 이라면 `Npgsql.EntityFrameworkCore.PostgreSQL` 이 같은 자리에 들어간다. `Microsoft.EntityFrameworkCore.Design` 은 `dotnet ef` 명령이 이 프로젝트를 읽을 때만 쓰는 개발용 패키지다.

템플릿이 만든 `WeatherForecast` 예제 코드는 지워도 된다. `Program.cs` 는 아래에서 `reference/Program.cs` 로 통째로 바꾼다.

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

각 명령이 하는 일:

| 명령 | 결과 |
| --- | --- |
| `dotnet build` | 컴파일. TS 의 `tsc --noEmit` 처럼 타입 오류를 여기서 다 잡는다 |
| `migrations add InitialCreate` | `Migrations/` 폴더에 "빈 DB 를 지금 엔티티 모양으로 만드는" C# 코드 생성 |
| `migrations script` | 그 코드가 실행할 SQL(`CREATE TABLE owners ...`, `CREATE INDEX ...`)을 출력만 한다 |
| `database update` | 실제로 SQL 을 실행. `petclinic.db` 파일과 `__EFMigrationsHistory` 테이블이 생긴다 |
| `dotnet watch run` | 서버 실행. 코드를 저장하면 다시 반영 |

`migrations script` 출력에서 `CREATE INDEX "IX_pets_OwnerId_Name" ON "pets" ("OwnerId", "Name")` 를 찾아 보라. `AppDbContext.cs` 의 `HasIndex(p => new { p.OwnerId, p.Name })` 한 줄이 이렇게 된다.

---

## 3. 동작 확인

가장 쉬운 방법은 **브라우저로 `http://localhost:5000/openapi/v1.json`** 을 열거나,
Visual Studio 의 `.http` 파일 / VS Code 의 REST Client 확장을 쓰는 것이다.
CLI 로 하려면 아래를 쓴다.

`openapi/v1.json` 은 이 API 의 엔드포인트 목록과 요청·응답 모양을 적은 JSON 문서다. 화면이 있는 Swagger UI 는 .NET 9 템플릿에 기본으로 들어 있지 않아서 JSON 만 보인다. 화면이 필요하면 `reference/NOTES.md` 의 Swashbuckle 설정을 쓰거나 `.http` 파일로 요청을 보낸다.

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

검증 실패 요청에는 `ownerId` 가 아예 없다. `Guid` 는 값 타입이라 `null` 이 될 수 없으므로 빠진 `ownerId` 는 `00000000-...`(`Guid.Empty`)로 채워진다. `[Required]` 는 `null` 만 막기 때문에 이 값은 통과한다. 이 요청이 400 인 이유는 빈 `name` 하나다. 이름을 채워 다시 보내면 이번엔 "보호자를 찾을 수 없다" 404 가 나온다. 형식 검증이 통과한 뒤 업무 규칙 1번에서 걸린 것이다. (→ `02-csharp-dotnet/01-csharp-for-ts-devs.md` 2절)

## 4. 반드시 해볼 것 — 여기가 진짜 실습

### ① SQL 을 눈으로 본다

`Program.cs` 에 이미 로깅이 켜져 있다. 목록 API 를 한 번 호출하고 콘솔을 봐라.

```
info: Microsoft.EntityFrameworkCore.Database.Command[20101]
      Executed DbCommand ... SELECT "p"."Id", "p"."Name", ... FROM "Pets" AS "p" ...
```

**LINQ 가 SQL 로 번역되는 걸 직접 보는 것.** 이게 EF Core 를 이해하는 유일한 방법이다.

목록 API 한 번에 SQL 이 두 개 나간다. `PetService.ListAsync` 가 `CountAsync` 로 전체 개수를 한 번, 페이지 데이터를 한 번 가져오기 때문이다. 두 번째 SQL 에 `ORDER BY ... LIMIT ... OFFSET` 과 `INNER JOIN owners` 가 있는지, 첫 번째에도 `NOT IsDeleted` 가 붙어 있는지 확인한다.

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

펫을 20마리쯤 만들어 두고 목록을 호출하면 **콘솔에 SELECT 가 21번** 찍힌다.
이걸 한 번 보고 나면 N+1 을 절대 잊지 않는다.

여기서 `query` 는 `.Select(...)` 바로 앞까지 이어 둔 쿼리(정렬·`Skip`·`Take` 가 붙은 것)를 변수로 뺀 것이다. 21번은 목록 1번 + 펫마다 보호자 1번(20)이다. `CountAsync` 까지 세면 콘솔에는 22개가 보인다. 펫 20마리가 모두 같은 보호자라면 `FindAsync` 는 두 번째부터 이미 추적 중인 보호자를 돌려주므로 쿼리가 1번으로 줄어든다. N+1 을 제대로 보려면 보호자를 여러 명 만들어 나눠 등록한다.

### ③ `AsNoTracking()` 을 빼본다

목록 조회에서 빼고 그 다음 `SaveChangesAsync()` 를 부르는 코드를 넣어보면
의도치 않은 UPDATE 가 나가는 걸 만들 수 있다.

주의할 점이 하나 있다. 지금 `ListAsync` 는 `.Select(...)` 로 DTO 를 만들기 때문에 `AsNoTracking()` 을 빼도 아무것도 추적되지 않는다. Projection 결과는 엔티티가 아니기 때문이다. 추적 때문에 생기는 사고를 보려면 엔티티를 그대로 가져와야 한다.

```csharp
// 실험용 — ListAsync 안에 잠깐 넣어 본다
var entities = await db.Pets.Take(3).ToListAsync(ct);    // AsNoTracking 없음 → 추적
entities[0].Name = entities[0].Name.Trim() + " ";        // 화면용으로 고쳤다고 착각
await db.SaveChangesAsync(ct);                           // 콘솔에 UPDATE "pets" SET "Name" = ... 가 찍힌다
```

같은 코드에 `.AsNoTracking()` 을 붙이면 `SaveChangesAsync()` 를 불러도 SQL 이 하나도 나가지 않는다. 확인했으면 실험 코드는 지운다.

### ④ 글로벌 쿼리 필터를 확인한다

`AppDbContext` 에 `HasQueryFilter(p => !p.IsDeleted)` 가 있다.
소프트 삭제된 펫이 목록에 안 나오는지, 그리고 **SQL 에 `WHERE NOT IsDeleted` 가 자동으로 붙는지** 확인해라.
`IgnoreQueryFilters()` 로 우회할 수 있다는 것도 확인.

```csharp
// 삭제된 것까지 포함해서 보기 — 관리자 화면이나 복구 기능에서 쓰는 모양
var all = await db.Pets.IgnoreQueryFilters().AsNoTracking().ToListAsync(ct);
```

> 멀티테넌시의 `tenant_id` 필터가 정확히 이 메커니즘이다.

멀티테넌시 필터에 `IgnoreQueryFilters()` 를 쓰면 다른 고객사의 데이터까지 보인다. 그래서 회사 코드에서 이 메서드를 보면 "왜 여기서 필터를 껐나"를 반드시 확인한다.

### ⑤ 마이그레이션을 하나 더 만들어 본다

`Pet` 에 `public string? Memo { get; set; }` 를 추가하고:

```bash
dotnet ef migrations add AddPetMemo
dotnet ef migrations script AddPetMemo      # 이전 마이그레이션 이후의 SQL 만
dotnet ef database update
```

생성된 마이그레이션 파일의 `Up()` / `Down()` 을 읽어봐라.

`string?` 로 선언했으므로 `Up()` 에는 `nullable: true` 인 컬럼 추가가 들어 있다. `string Memo`(물음표 없음)로 바꿔 다시 만들어 보면 `nullable: false` 와 기본값 `""` 이 들어간다. 기존 행이 있는 테이블에 NOT NULL 컬럼을 추가하려면 기존 행에 넣을 값이 필요하기 때문이다. 이 차이가 운영 배포에서 자주 문제가 된다. (→ `01-backend-basics/03-database.md` 7절)

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

`WebApplicationFactory` 는 실제 서버 포트를 열지 않고 메모리 안에서 앱을 띄운다. `factory.CreateClient()` 가 주는 `HttpClient` 는 네트워크를 거치지 않고 그 앱으로 요청을 바로 보낸다. 미들웨어·DI·라우팅·예외 핸들러가 모두 실제와 같이 돈다. 그래서 "404 가 정말 나가는가"를 확인할 수 있다. `reference/Program.cs` 맨 끝의 `public partial class Program;` 은 테스트 프로젝트가 이 `Program` 을 참조할 수 있게 하려는 것이다. (→ `reference/NOTES.md`)

**DB 를 테스트용으로 바꾸는 단계가 하나 필요할 수 있다.** `reference/PetApiTests.cs` 는 앱 설정을 그대로 쓴다. `Program.cs` 의 기본 연결 문자열 `Data Source=petclinic.db` 는 상대 경로라서 테스트 실행 폴더(`bin/...`)에 테이블이 없는 빈 DB 파일이 생길 수 있다. `SQLite Error 1: 'no such table: owners'` 가 나면 이 경우다. 아래처럼 테스트 전용 팩토리를 만들어 임시 DB 파일을 쓰고 테이블을 만들어 둔다.

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PetClinic.Api;

public class PetApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbPath =
        Path.Combine(Path.GetTempPath(), $"petclinic-test-{Guid.NewGuid():N}.db");

    // 앱 설정의 ConnectionStrings:Default 를 테스트용 파일로 덮어쓴다
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={_dbPath}");

    // 앱이 뜬 직후 엔티티 모양대로 테이블을 만든다
    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreated();
        return host;
    }
}
```

그리고 테스트 클래스의 `WebApplicationFactory<Program>` 두 곳을 `PetApiFactory` 로 바꾼다. 이 방식은 SQLite 를 그대로 쓰므로 위에서 설치한 `Microsoft.EntityFrameworkCore.InMemory` 는 필요 없다. InMemory 프로바이더는 진짜 DB 가 아니라서 SQL 번역 오류나 제약 조건 위반을 잡지 못한다. 회사 코드의 통합 테스트가 Testcontainers 로 진짜 PostgreSQL 을 띄우는 것도 같은 이유다. (→ `02-csharp-dotnet/02-aspnet-core.md` 8절)

테스트 이름이 한국어 문장(`같은_보호자에게_같은_이름이면_409`)인 것도 눈여겨본다. 테스트 목록이 그대로 기능 명세가 된다.

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

과제별 힌트를 짧게 남긴다.

- **PUT**: 추적 조회(`FirstOrDefaultAsync`) → 프로퍼티 변경 → `SaveChangesAsync()`. `db.Update()` 는 부르지 않는다. 이름을 바꿀 때도 규칙 3(중복 이름)을 다시 검사해야 한다.
- **검색 필터**: `ListAsync` 의 `if (!string.IsNullOrWhiteSpace(species)) q = q.Where(...)` 와 같은 모양으로 `q` 조건을 하나 더 쌓는다. SQL 로그에서 조건이 있을 때와 없을 때 WHERE 절이 달라지는지 본다.
- **커서 페이지네이션**: `Skip` 대신 "마지막으로 본 항목의 `(CreatedAt, Id)` 보다 뒤"라는 조건을 쓴다. (→ `01-backend-basics/03-database.md` 5절)
- **테넌트 필터**: 헤더 값을 Scoped 서비스에 담고 `AppDbContext` 가 그 서비스를 받아 필터에 쓴다. 모양은 `02-csharp-dotnet/03-ef-core.md` 1절의 `CurrentTenantId` 예제와 같다.
- **PostgreSQL 교체**: `UseSqlite(...)` 를 `UseNpgsql(...)` 로, 연결 문자열을 바꾼 뒤 기존 `Migrations/` 폴더를 지우고 다시 만든다. 마이그레이션은 프로바이더별 SQL 을 담고 있어서 그대로 옮겨 쓸 수 없다.

---

## 6. 끝나고 스스로 답해보기

1. `builder.Services.AddScoped` 와 `AddSingleton` 을 바꾸면 어디서 터지나?
2. `Include` 와 `Select` 중 뭘 썼고 SQL 이 어떻게 달랐나?
3. 409 를 만드는 코드는 어느 계층에 있나? 왜 거기인가?
4. `dotnet ef migrations script` 로 본 SQL 에서 인덱스가 어디에 생겼나?
5. 마이그레이션을 되돌리려면? 되돌릴 수 없는 마이그레이션은 어떤 것인가?
6. 목록 API 에서 `AsNoTracking()` 을 빼도 UPDATE 사고가 나지 않는 이유는? 어떻게 바꾸면 사고가 나나?
7. 테스트가 `no such table` 로 실패했다면 원인은 무엇이고 어떻게 고치나?

1번의 힌트: `PetService` 를 Singleton 으로 바꾸면 Scoped 인 `AppDbContext` 를 생성자로 받게 된다. 개발 환경에서는 앱이 시작될 때 "Cannot consume scoped service ... from singleton ..." 예외로 바로 알려 준다. 이걸 **captive dependency** 라고 한다. 오래 사는 객체가 짧게 살아야 할 객체를 붙잡아 가두는 상황이다. (→ `01-backend-basics/02-layers-and-di.md` 4절)
