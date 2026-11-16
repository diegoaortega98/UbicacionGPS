using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace GpsSystem.Tests;

public sealed class AdminControllerTests
{
    [Fact]
    public async Task StatisticsAreAdminOnlyAndIncludeCompletedRideMetrics()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();

        string adminToken;
        string passengerToken;
        using (var scope = factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<Usuario>>();
            var tokenService = scope.ServiceProvider.GetRequiredService<ITokenService>();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var admin = await CreateUserAsync(userManager, RolesUsuario.Admin);
            var passenger = await CreateUserAsync(userManager, RolesUsuario.Pasajero);
            var driver = await CreateUserAsync(userManager, RolesUsuario.Conductor);
            adminToken = tokenService.CrearToken(admin);
            passengerToken = tokenService.CrearToken(passenger);

            var now = DateTimeOffset.UtcNow;
            dbContext.Viajes.AddRange(
                new Viaje
                {
                    PasajeroId = passenger.Id,
                    ConductorId = driver.Id,
                    Estado = EstadosViaje.Finalizado,
                    Pin = "hash-1",
                    ComisionPlataforma = 12.5m,
                    FechaCreacion = now.AddHours(-1),
                    FechaFinalizacion = now
                },
                new Viaje
                {
                    PasajeroId = passenger.Id,
                    ConductorId = driver.Id,
                    Estado = EstadosViaje.Finalizado,
                    Pin = "hash-2",
                    ComisionPlataforma = 7.5m,
                    FechaCreacion = now.AddDays(-1),
                    FechaFinalizacion = now.AddDays(-1)
                },
                new Viaje
                {
                    PasajeroId = passenger.Id,
                    Estado = EstadosViaje.Cancelado,
                    Pin = "hash-3",
                    ComisionPlataforma = 99m,
                    FechaCreacion = now,
                    FechaFinalizacion = now
                });
            await dbContext.SaveChangesAsync();

            var tracker = scope.ServiceProvider.GetRequiredService<IConductoresActivosTracker>();
            tracker.EstablecerDisponibilidad("connection-1", driver.Id, true);
            tracker.EstablecerDisponibilidad("connection-2", driver.Id, true);
        }

        using var unauthorized = await client.GetAsync("/api/admin/estadisticas");
        unauthorized.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var forbidden = await GetAuthorizedAsync(
            client,
            "/api/admin/estadisticas",
            passengerToken);
        forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var response = await GetAuthorizedAsync(
            client,
            "/api/admin/estadisticas",
            adminToken);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var statistics = await response.Content.ReadFromJsonAsync<AdminEstadisticasResponse>();
        statistics.Should().Be(new AdminEstadisticasResponse(2, 20m, 1, 1, 12.5m));
    }

    private static async Task<Usuario> CreateUserAsync(UserManager<Usuario> userManager, string role)
    {
        var email = $"{role.ToLowerInvariant()}-{Guid.NewGuid():N}@example.com";
        var user = new Usuario
        {
            UserName = email,
            Email = email,
            Nombre = role,
            Telefono = "5551234567",
            Rol = role
        };
        var createResult = await userManager.CreateAsync(user, "AdminTest!2026");
        createResult.Succeeded.Should().BeTrue(
            string.Join("; ", createResult.Errors.Select(error => error.Description)));
        var roleResult = await userManager.AddToRoleAsync(user, role);
        roleResult.Succeeded.Should().BeTrue(
            string.Join("; ", roleResult.Errors.Select(error => error.Description)));
        return user;
    }

    private static async Task<HttpResponseMessage> GetAuthorizedAsync(
        HttpClient client,
        string path,
        string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }
}
