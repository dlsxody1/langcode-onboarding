// PetClinic.Tests 프로젝트에 넣는다.
//   dotnet new xunit -n PetClinic.Tests
//   dotnet add reference ../PetClinic.Api
//   dotnet add package Microsoft.AspNetCore.Mvc.Testing

using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using PetClinic.Api;
using Xunit;

namespace PetClinic.Tests;

// WebApplicationFactory: 앱 전체(미들웨어·DI·라우팅)를 메모리에 띄우고 실제 HTTP 요청을 보낸다.
// 프론트로 치면 E2E 에 가까운 신뢰도를 단위 테스트 속도로 얻는 것.
public class PetApiTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private HttpClient Client => factory.CreateClient();

    [Fact]
    public async Task 없는_펫을_조회하면_404()
    {
        var res = await Client.GetAsync($"/api/pets/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task 펫을_생성하면_201과_Location_헤더()
    {
        var owner = await CreateOwnerAsync();

        var res = await Client.PostAsJsonAsync("/api/pets",
            new CreatePetRequest("코코", "dog", new DateOnly(2022, 3, 1), owner.Id));

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.NotNull(res.Headers.Location);

        var pet = await res.Content.ReadFromJsonAsync<PetDto>();
        Assert.Equal("코코", pet!.Name);
        Assert.Equal(owner.Name, pet.OwnerName);
    }

    [Fact]
    public async Task 같은_보호자에게_같은_이름이면_409()
    {
        var owner = await CreateOwnerAsync();
        var req = new CreatePetRequest("루비", "cat", null, owner.Id);

        await Client.PostAsJsonAsync("/api/pets", req);
        var second = await Client.PostAsJsonAsync("/api/pets", req);

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task 생년월일이_미래면_400()
    {
        var owner = await CreateOwnerAsync();
        var future = DateOnly.FromDateTime(DateTime.UtcNow.AddYears(1));

        var res = await Client.PostAsJsonAsync("/api/pets",
            new CreatePetRequest("미래", "dog", future, owner.Id));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task 없는_보호자면_404()
    {
        var res = await Client.PostAsJsonAsync("/api/pets",
            new CreatePetRequest("유령", "dog", null, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task 삭제하면_목록에서_사라진다()
    {
        var owner = await CreateOwnerAsync();
        var created = await (await Client.PostAsJsonAsync("/api/pets",
            new CreatePetRequest($"삭제대상{Guid.NewGuid():N}", "dog", null, owner.Id)))
            .Content.ReadFromJsonAsync<PetDto>();

        var del = await Client.DeleteAsync($"/api/pets/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        // 소프트 삭제 + 글로벌 쿼리 필터 → 조회되지 않아야 한다
        var get = await Client.GetAsync($"/api/pets/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    private async Task<OwnerDto> CreateOwnerAsync()
    {
        var res = await Client.PostAsJsonAsync("/api/owners",
            new CreateOwnerRequest($"보호자{Guid.NewGuid():N}"[..20], "010-0000-0000"));
        return (await res.Content.ReadFromJsonAsync<OwnerDto>())!;
    }
}
