using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using GpsSystem.Api.Models;

namespace GpsSystem.Tests;

public sealed class SignalRTests
{
    [Fact]
    public async Task HubNegotiationAcceptsJwtFromAccessTokenQueryString()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var email = $"signalr-{Guid.NewGuid():N}@example.com";
        const string password = "SignalR!2026";

        using var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = email,
            Password = password,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        registration.StatusCode.Should().Be(HttpStatusCode.OK);

        using var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = email,
            Password = password
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var account = await login.Content.ReadFromJsonAsync<AuthResponse>();
        account.Should().NotBeNull();

        using var unauthorizedNegotiation = await SendNegotiationAsync(client, "/hubs/viajes/negotiate?negotiateVersion=1");
        unauthorizedNegotiation.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var accessToken = Uri.EscapeDataString(account!.Token);
        using var authorizedNegotiation = await SendNegotiationAsync(
            client,
            $"/hubs/viajes/negotiate?negotiateVersion=1&access_token={accessToken}");
        authorizedNegotiation.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static async Task<HttpResponseMessage> SendNegotiationAsync(HttpClient client, string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        return await client.SendAsync(request);
    }
}
