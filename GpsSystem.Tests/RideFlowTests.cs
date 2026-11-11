using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using GpsSystem.Api.Models;

namespace GpsSystem.Tests;

public sealed class RideFlowTests
{
    [Fact]
    public async Task PassengerAndDriverCanCompleteRideFlow()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();

        var suffix = Guid.NewGuid().ToString("N");
        const string password = "RideFlow!2026";
        var passengerEmail = $"passenger-{suffix}@example.com";
        var driverEmail = $"driver-{suffix}@example.com";

        using var passengerRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = passengerEmail,
            Password = password,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        passengerRegistration.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);

        using var driverRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = driverEmail,
            Password = password,
            Telefono = "5559876543",
            Rol = RolesUsuario.Conductor,
            Vehiculo = "Sedan",
            Placa = $"T{suffix[..7]}"
        });
        driverRegistration.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Created);

        using var passengerLogin = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = passengerEmail,
            Password = password
        });
        passengerLogin.StatusCode.Should().Be(HttpStatusCode.OK);
        var passengerAuth = await passengerLogin.Content.ReadFromJsonAsync<AuthResponse>();
        passengerAuth.Should().NotBeNull();
        passengerAuth!.Token.Should().NotBeNullOrWhiteSpace();

        using var driverLogin = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = driverEmail,
            Password = password
        });
        driverLogin.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverAuth = await driverLogin.Content.ReadFromJsonAsync<AuthResponse>();
        driverAuth.Should().NotBeNull();
        driverAuth!.Token.Should().NotBeNullOrWhiteSpace();

        using var requestRide = await PostAuthorizedAsync(client, "/api/viajes/solicitar", passengerAuth.Token, new
        {
            OrigenLat = 19.4326,
            OrigenLng = -99.1332,
            DestinoLat = 19.4270,
            DestinoLng = -99.1276
        });
        requestRide.StatusCode.Should().Be(HttpStatusCode.Created);
        var rideRequest = await requestRide.Content.ReadFromJsonAsync<SolicitudViajeResponse>();
        rideRequest.Should().NotBeNull();
        rideRequest!.Pin.Should().MatchRegex("^\\d{4}$");

        using var acceptRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/aceptar",
            driverAuth.Token);
        acceptRide.StatusCode.Should().Be(HttpStatusCode.OK);

        using var startRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/iniciar",
            driverAuth.Token,
            new { Pin = rideRequest.Pin });
        startRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var startedRide = await startRide.Content.ReadFromJsonAsync<ViajeResponse>();
        startedRide.Should().NotBeNull();
        startedRide!.Estado.Should().Be(EstadosViaje.EnCurso);
    }

    private static async Task<HttpResponseMessage> PostAuthorizedAsync(
        HttpClient client,
        string path,
        string token,
        object? body = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return await client.SendAsync(request);
    }
}
