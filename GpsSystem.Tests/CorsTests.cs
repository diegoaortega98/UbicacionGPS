using System.Net;
using FluentAssertions;

namespace GpsSystem.Tests;

public sealed class CorsTests
{
    [Theory]
    [InlineData("http://localhost:5023")]
    [InlineData("https://ubicaciongps.onrender.com")]
    public async Task AllowedOriginsCanMakeCredentialedPreflightRequests(string origin)
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/auth/login");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");

        using var response = await client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
        response.Headers.GetValues("Access-Control-Allow-Origin").Should().ContainSingle().Which.Should().Be(origin);
        response.Headers.GetValues("Access-Control-Allow-Credentials").Should().ContainSingle().Which.Should().Be("true");
    }
}
