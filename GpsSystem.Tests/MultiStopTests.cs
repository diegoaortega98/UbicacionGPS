using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using GpsSystem.Api.Models;

namespace GpsSystem.Tests;

public sealed class MultiStopTests
{
    [Fact]
    public async Task RequestStoresOrderedStopsAndPricesEveryRouteSegment()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var email = $"multi-stop-{Guid.NewGuid():N}@example.com";

        using var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = email,
            Password = "MultiStop!2026",
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        registration.StatusCode.Should().Be(HttpStatusCode.OK);
        var account = await registration.Content.ReadFromJsonAsync<AuthResponse>();
        account.Should().NotBeNull();

        var origin = (Latitude: 10.391, Longitude: -75.4794);
        var firstStop = (Latitude: 10.43, Longitude: -75.46);
        var secondStop = (Latitude: 10.38, Longitude: -75.51);
        var destination = (Latitude: 10.427, Longitude: -75.516);

        using var tooManyStops = await PostAuthorizedAsync(client, account!.Token, new
        {
            OrigenLat = origin.Latitude,
            OrigenLng = origin.Longitude,
            DestinoLat = destination.Latitude,
            DestinoLng = destination.Longitude,
            Paradas = new[]
            {
                new { Latitud = firstStop.Latitude, Longitud = firstStop.Longitude },
                new { Latitud = secondStop.Latitude, Longitud = secondStop.Longitude },
                new { Latitud = 10.418, Longitud = -75.508 },
                new { Latitud = 10.421, Longitud = -75.512 }
            }
        });
        tooManyStops.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var request = await PostAuthorizedAsync(client, account.Token, new
        {
            OrigenLat = origin.Latitude,
            OrigenLng = origin.Longitude,
            DestinoLat = destination.Latitude,
            DestinoLng = destination.Longitude,
            Paradas = new[]
            {
                new { Latitud = firstStop.Latitude, Longitud = firstStop.Longitude },
                new { Latitud = secondStop.Latitude, Longitud = secondStop.Longitude }
            }
        });
        request.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await request.Content.ReadFromJsonAsync<SolicitudViajeResponse>();
        created.Should().NotBeNull();
        created!.Paradas.Select(parada => parada.Orden).Should().Equal(1, 2);
        created.Pin.Should().MatchRegex("^\\d{4}$");
        created.Precio.Should().Be(EstimatePrice(origin, firstStop, secondStop, destination));
        created.Precio.Should().BeGreaterThan(EstimatePrice(origin, destination));

        using var tripResponse = await GetAuthorizedAsync(client, account.Token, $"/api/viajes/{created.Id}");
        tripResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var trip = await tripResponse.Content.ReadFromJsonAsync<ViajeResponse>();
        trip.Should().NotBeNull();
        trip!.Paradas.Select(parada => (parada.Orden, parada.Latitud, parada.Longitud))
            .Should()
            .Equal(
                (1, firstStop.Latitude, firstStop.Longitude),
                (2, secondStop.Latitude, secondStop.Longitude));
    }

    private static decimal EstimatePrice(params (double Latitude, double Longitude)[] waypoints)
    {
        var distanceKm = 0d;
        for (var index = 1; index < waypoints.Length; index++)
        {
            var origin = waypoints[index - 1];
            var destination = waypoints[index];
            var latitude1 = origin.Latitude * Math.PI / 180d;
            var latitude2 = destination.Latitude * Math.PI / 180d;
            var latitudeDelta = (destination.Latitude - origin.Latitude) * Math.PI / 180d;
            var longitudeDelta = (destination.Longitude - origin.Longitude) * Math.PI / 180d;
            var haversine = Math.Pow(Math.Sin(latitudeDelta / 2), 2)
                + Math.Cos(latitude1) * Math.Cos(latitude2)
                * Math.Pow(Math.Sin(longitudeDelta / 2), 2);
            distanceKm += 2 * 6371 * Math.Asin(Math.Sqrt(haversine));
        }

        var estimate = 5000m + (decimal)(distanceKm * 1.3) * 1800m;
        return decimal.Ceiling(estimate / 500m) * 500m;
    }

    private static async Task<HttpResponseMessage> PostAuthorizedAsync(
        HttpClient client,
        string token,
        object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/viajes/solicitar")
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> GetAuthorizedAsync(
        HttpClient client,
        string token,
        string path)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }
}
