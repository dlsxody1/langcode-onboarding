# reference 코드에 대한 메모

`reference/*.cs` 를 그대로 옮겼을 때 걸리기 쉬운 지점을 모았다. 에러 메시지로 검색해서 해당 절을 찾으면 된다.

## `.WithParameterValidation()` 이 컴파일 안 되면

Minimal API 의 DataAnnotations 자동 검증은 .NET 버전에 따라 제공 방식이 다르다.

배경부터 짚는다. 컨트롤러 방식은 `[ApiController]` 가 요청 DTO 의 `[Required]`, `[StringLength]` 를 자동으로 검사해서 400 을 돌려준다. Minimal API 는 오랫동안 이 기능이 없었다. 그래서 `Program.cs` 의 `.WithParameterValidation()` 같은 줄로 검증을 따로 붙여야 했다. 이 메서드는 .NET 기본 API 가 아니라 `MinimalApis.Extensions` 패키지가 제공하는 확장 메서드다. 패키지 없이는 `'RouteHandlerBuilder' does not contain a definition for 'WithParameterValidation'` 컴파일 에러가 난다.

- **.NET 10+**: 내장. `builder.Services.AddValidation()` 등록 후 사용 가능. 등록하면 모든 엔드포인트에 자동 적용되므로 `.WithParameterValidation()` 줄은 지운다
- **그 이전**: `MinimalApis.Extensions` 패키지를 설치하거나, 아래처럼 직접 검증

```bash
dotnet add package MinimalApis.Extensions     # 그 이전 버전에서 .WithParameterValidation() 을 그대로 쓰려면
```

```csharp
// 그 줄을 지우고, 핸들러 안에서 직접
using System.ComponentModel.DataAnnotations;

var ctx = new ValidationContext(req);
var results = new List<ValidationResult>();
if (!Validator.TryValidateObject(req, ctx, results, validateAllProperties: true))
    return Results.ValidationProblem(
        results.GroupBy(r => r.MemberNames.FirstOrDefault() ?? "")
               .ToDictionary(g => g.Key, g => g.Select(r => r.ErrorMessage ?? "").ToArray()));
```

`GroupBy` 를 거치는 이유는 한 필드에 에러가 둘 이상일 수 있어서다. 바로 `ToDictionary` 하면 같은 키가 두 번 들어가 `ArgumentException` 이 난다.

> ⚠️ 직접 검증을 쓸 때 꼭 확인할 것: `Validator.TryValidateObject` 는 **프로퍼티**에 붙은 어트리뷰트를 읽는다. `Domain.cs` 의 `CreatePetRequest` 처럼 record 의 위치 매개변수에 `[Required]` 를 쓰면 어트리뷰트가 기본으로 **생성자 매개변수**에 붙는다. 그래서 이 방법으로는 검사되지 않고 빈 이름이 그대로 통과할 수 있다. 빈 `name` 으로 요청해서 400 이 나오는지 반드시 확인하라. 통과해 버리면 `[property: Required, StringLength(50, MinimumLength = 1)] string Name` 처럼 대상을 프로퍼티로 지정한다. (이 실습은 컨트롤러를 쓰지 않으니 괜찮지만 MVC 컨트롤러는 반대로 프로퍼티 쪽 지정을 거부한다 → `02-csharp-dotnet/02-aspnet-core.md` 7절)

**컨트롤러 방식(`[ApiController]`)에서는 이게 전부 자동이다.** 이게 컨트롤러를 쓰는 이유 중 하나다.

## `AddOpenApi()` 가 없다고 나오면

.NET 9 부터의 API 다. .NET 8 이하라면:

```bash
dotnet add package Swashbuckle.AspNetCore
```
```csharp
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
// ...
app.UseSwagger();
app.UseSwaggerUI();
```

`AddOpenApi()` 는 `Microsoft.AspNetCore.OpenApi` 패키지에 들어 있고 .NET 9 의 `webapi` 템플릿이 이 패키지를 미리 넣어 준다. 템플릿 없이 만든 프로젝트라면 이 패키지를 직접 추가해야 할 수 있다. Swashbuckle 은 .NET 8 까지 템플릿 기본값이던 라이브러리로, `/swagger` 에서 브라우저로 API 를 눌러 볼 수 있는 화면(Swagger UI)까지 준다. .NET 9 에서도 이 화면이 필요하면 Swashbuckle 을 같이 써도 된다.

## `public partial class Program;` 이 왜 필요한가

Minimal API 는 top-level statements 로 작성되어 `Program` 클래스가 `internal` 로 생성된다.
테스트 프로젝트에서 `WebApplicationFactory<Program>` 을 쓰려면 public 이어야 한다.

**top-level statements** 는 `class Program { static void Main() { ... } }` 껍데기 없이 파일에 코드를 바로 쓰는 문법이다. 컴파일러가 보이지 않는 `Program` 클래스를 만들어 그 안에 넣어 준다. 이 숨은 클래스가 `internal` 이라 다른 프로젝트(테스트)에서 이름으로 가리킬 수 없다. `partial` 은 "이 클래스의 나머지 부분이 다른 곳에 있다"는 표시다. 컴파일러가 만든 `Program` 과 내가 쓴 선언이 하나로 합쳐지면서 `public` 이 된다.

## 테스트가 `no such table` 로 실패하면

`reference/PetApiTests.cs` 는 앱의 DB 설정을 그대로 쓴다. 기본 연결 문자열 `Data Source=petclinic.db` 는 상대 경로라 테스트 실행 폴더에 빈 DB 파일이 생기고 `SQLite Error 1: 'no such table: owners'` 가 날 수 있다. 테스트용 임시 DB 를 쓰고 `EnsureCreated()` 로 테이블을 만드는 팩토리 예제를 `README.md` 4절 ⑥에 두었다.

## SQLite 의 한계

- `DateOnly` 매핑이 버전에 따라 다를 수 있다. 문제가 생기면 `DateTime` 으로 바꿔라
- `RowVersion` (낙관적 동시성) 은 SQLite 에서 기본 지원이 안 된다. PostgreSQL 로 바꾼 뒤 실습
- 동시성·격리 수준 실습도 SQLite 로는 제한적이다
- `EF.Functions.ILike` 는 PostgreSQL 전용이라 SQLite 에서는 쓸 수 없다. SQLite 의 `LIKE` 는 영문 대소문자를 기본으로 구분하지 않는다

**회사 스택(PostgreSQL/MSSQL)과 다른 건 연결 문자열과 프로바이더뿐이다.** EF Core 코드는 거의 같다.

"프로바이더"는 EF Core 가 특정 DB 와 대화하게 해 주는 패키지다. `UseSqlite(...)` 를 `UseNpgsql(...)` 로 바꾸고 패키지를 교체하면 LINQ 코드는 그대로 두고 대상 DB 만 바뀐다. 다만 마이그레이션 파일은 프로바이더별 SQL 타입을 담고 있어서 DB 를 바꾸면 새로 만들어야 한다.
