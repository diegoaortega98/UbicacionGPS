using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using FluentAssertions;
using GpsSystem.Api.Data;
using GpsSystem.Api.Hubs;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GpsSystem.Tests;

public sealed class SuperE2ETests
{
    [Fact]
    public async Task AdminDriverAndPassengerCompleteDiscountedMultiStopRideLifecycle()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var suffix = Guid.NewGuid().ToString("N");
        const string password = "SuperE2E!2026";
        var adminEmail = $"admin-{suffix}@example.com";
        var driverEmail = $"driver-{suffix}@example.com";
        var passengerEmail = $"passenger-{suffix}@example.com";

        using (var scope = factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<Usuario>>();
            var admin = new Usuario
            {
                UserName = adminEmail,
                Email = adminEmail,
                Nombre = "Admin E2E",
                Telefono = "5550000000",
                Rol = RolesUsuario.Admin
            };
            (await userManager.CreateAsync(admin, password)).Succeeded.Should().BeTrue();
            (await userManager.AddToRoleAsync(admin, RolesUsuario.Admin)).Succeeded.Should().BeTrue();

            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            dbContext.Promociones.Add(new Promocion
            {
                Codigo = "VENCIDO-E2E",
                PorcentajeDescuento = 25,
                EstaActiva = true,
                FechaExpiracion = DateTime.UtcNow.AddMinutes(-1)
            });
            await dbContext.SaveChangesAsync();
        }

        var adminAuth = await LoginAsync(client, adminEmail, password);
        using var initialStatsResponse = await GetAuthorizedAsync(
            client,
            "/api/admin/estadisticas",
            adminAuth.Token);
        initialStatsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await initialStatsResponse.Content.ReadFromJsonAsync<AdminEstadisticasResponse>())
            .Should().Be(new AdminEstadisticasResponse(0, 0m, 0, 0, 0m));

        using var createPromo = await PostAuthorizedAsync(client, "/api/admin/promos", adminAuth.Token, new
        {
            Codigo = "SUPER20",
            PorcentajeDescuento = 20,
            FechaExpiracion = DateTimeOffset.UtcNow.AddDays(1)
        });
        createPromo.StatusCode.Should().Be(HttpStatusCode.Created);

        using var driverRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = driverEmail,
            Password = password,
            Telefono = "5559876543",
            Rol = RolesUsuario.Conductor,
            Vehiculo = "Sedan",
            Placa = $"S{suffix[..7]}"
        });
        driverRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverAuth = await LoginAsync(client, driverEmail, password);

        using var passengerRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = passengerEmail,
            Password = password,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        passengerRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var passengerAuth = await LoginAsync(client, passengerEmail, password);

        using var saveFavorites = await PutAuthorizedAsync(
            client,
            "/api/auth/lugares-favoritos",
            passengerAuth.Token,
            new
            {
                DireccionCasa = "Casa de prueba",
                LatCasa = 10.391,
                LngCasa = -75.4794,
                DireccionTrabajo = "Trabajo de prueba",
                LatTrabajo = 10.412,
                LngTrabajo = -75.51
            });
        saveFavorites.StatusCode.Should().Be(HttpStatusCode.OK);

        using var invalidPromo = await PostAuthorizedAsync(
            client,
            "/api/viajes/validar-promo",
            passengerAuth.Token,
            new { Codigo = "NO-EXISTE" });
        invalidPromo.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var expiredPromo = await PostAuthorizedAsync(
            client,
            "/api/viajes/validar-promo",
            passengerAuth.Token,
            new { Codigo = "VENCIDO-E2E" });
        expiredPromo.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var validPromo = await PostAuthorizedAsync(
            client,
            "/api/viajes/validar-promo",
            passengerAuth.Token,
            new { Codigo = " super20 " });
        validPromo.StatusCode.Should().Be(HttpStatusCode.OK);
        (await validPromo.Content.ReadFromJsonAsync<ValidarPromocionResponse>())
            .Should().Be(new ValidarPromocionResponse(20m));

        var origin = (Latitude: 10.391, Longitude: -75.4794);
        var firstStop = (Latitude: 10.43, Longitude: -75.46);
        var secondStop = (Latitude: 10.38, Longitude: -75.51);
        var destination = (Latitude: 10.427, Longitude: -75.516);
        using var tripRequest = await PostAuthorizedAsync(
            client,
            "/api/viajes/solicitar",
            passengerAuth.Token,
            new
            {
                OrigenLat = origin.Latitude,
                OrigenLng = origin.Longitude,
                DestinoLat = destination.Latitude,
                DestinoLng = destination.Longitude,
                CodigoPromo = "SUPER20",
                Paradas = new[]
                {
                    new { Latitud = firstStop.Latitude, Longitud = firstStop.Longitude },
                    new { Latitud = secondStop.Latitude, Longitud = secondStop.Longitude }
                }
            });
        tripRequest.StatusCode.Should().Be(HttpStatusCode.Created);
        var trip = await tripRequest.Content.ReadFromJsonAsync<SolicitudViajeResponse>();
        trip.Should().NotBeNull();
        trip!.Paradas.Select(parada => parada.Orden).Should().Equal(1, 2);
        trip.Precio.Should().Be(decimal.Round(
            EstimatePrice(origin, firstStop, secondStop, destination) * 0.8m,
            2,
            MidpointRounding.AwayFromZero));

        using var unverifiedAccept = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/aceptar",
            driverAuth.Token);
        unverifiedAccept.StatusCode.Should().Be(HttpStatusCode.Conflict);

        foreach (var tipoDocumento in new[] { "Licencia", "SOAT", "TarjetaPropiedad" })
        {
            using var upload = await UploadDocumentAsync(client, driverAuth.Token, tipoDocumento);
            upload.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using var submitVerification = await PostAuthorizedAsync(
            client,
            "/api/conductor/enviar-verificacion",
            driverAuth.Token);
        submitVerification.StatusCode.Should().Be(HttpStatusCode.OK);

        using var pendingResponse = await GetAuthorizedAsync(
            client,
            "/api/admin/conductores-pendientes",
            adminAuth.Token);
        pendingResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await pendingResponse.Content.ReadFromJsonAsync<List<ConductorPendienteResponse>>())
            .Should().ContainSingle(conductor => conductor.Id == driverAuth.UsuarioId);

        using var approveDriver = await PostAuthorizedAsync(
            client,
            $"/api/admin/verificar-conductor/{driverAuth.UsuarioId}",
            adminAuth.Token,
            new { Aprobado = true });
        approveDriver.StatusCode.Should().Be(HttpStatusCode.OK);

        using var acceptTrip = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/aceptar",
            driverAuth.Token);
        acceptTrip.StatusCode.Should().Be(HttpStatusCode.OK);

        using var arriving = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/llegando",
            driverAuth.Token);
        arriving.StatusCode.Should().Be(HttpStatusCode.OK);
        (await arriving.Content.ReadFromJsonAsync<ViajeResponse>())!.Estado
            .Should().Be(EstadosViaje.Llegando);

        using var start = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/iniciar",
            driverAuth.Token,
            new { Pin = trip.Pin });
        start.StatusCode.Should().Be(HttpStatusCode.OK);
        (await start.Content.ReadFromJsonAsync<ViajeResponse>())!.Estado
            .Should().Be(EstadosViaje.EnCurso);

        using var finish = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/finalizar",
            driverAuth.Token);
        finish.StatusCode.Should().Be(HttpStatusCode.OK);
        var settlement = await finish.Content.ReadFromJsonAsync<FinalizacionViajeResponse>();
        settlement.Should().NotBeNull();
        settlement!.MontoTotal.Should().Be(trip.Precio);
        settlement.GananciaNeta.Should().Be(
            settlement.MontoTotal - settlement.Comision);
        settlement.Viaje.Estado.Should().Be(EstadosViaje.PendientePago);

        using var confirmPayment = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/pago-recibido",
            driverAuth.Token);
        confirmPayment.StatusCode.Should().Be(HttpStatusCode.OK);
        (await confirmPayment.Content.ReadFromJsonAsync<ViajeResponse>())!.Estado
            .Should().Be(EstadosViaje.Finalizado);

        using var rateTrip = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/calificar",
            passengerAuth.Token,
            new { Estrellas = 5, Comentario = "Excelente" });
        rateTrip.StatusCode.Should().Be(HttpStatusCode.OK);
        (await rateTrip.Content.ReadFromJsonAsync<ViajeResponse>())!.Calificacion
            .Should().Be(5);

        using var driverWallet = await GetAuthorizedAsync(
            client,
            "/api/viajes/ganancias",
            driverAuth.Token);
        driverWallet.StatusCode.Should().Be(HttpStatusCode.OK);
        (await driverWallet.Content.ReadFromJsonAsync<GananciasResponse>())!
            .GananciasAcumuladas.Should().Be(settlement.GananciaNeta);

        using var earningsHistory = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial-conductor",
            driverAuth.Token);
        earningsHistory.StatusCode.Should().Be(HttpStatusCode.OK);
        (await earningsHistory.Content.ReadFromJsonAsync<List<HistorialViajeConductorResponse>>())
            .Should().ContainSingle(item =>
                item.ViajeId == trip.Id
                && item.MontoTotal == settlement.MontoTotal
                && item.Comision == settlement.Comision
                && item.GananciaNeta == settlement.GananciaNeta);

        using var cancelFinalized = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{trip.Id}/cancelar",
            passengerAuth.Token);
        cancelFinalized.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using var finalStatsResponse = await GetAuthorizedAsync(
            client,
            "/api/admin/estadisticas",
            adminAuth.Token);
        finalStatsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var finalStats = await finalStatsResponse.Content.ReadFromJsonAsync<AdminEstadisticasResponse>();
        finalStats.Should().NotBeNull();
        finalStats!.TotalViajes.Should().Be(1);
        finalStats.ComisionesTotales.Should().Be(settlement.Comision);
    }

    [Fact]
    public async Task DriverCannotSetAvailabilityUntilDocumentsAreApproved()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var email = $"availability-{Guid.NewGuid():N}@example.com";
        using var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = email,
            Password = "Availability!2026",
            Telefono = "5559876543",
            Rol = RolesUsuario.Conductor,
            Vehiculo = "Sedan",
            Placa = $"A{Guid.NewGuid():N}"[..8]
        });
        registration.StatusCode.Should().Be(HttpStatusCode.OK);
        var driver = await registration.Content.ReadFromJsonAsync<AuthResponse>();
        driver.Should().NotBeNull();

        var principal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, driver!.UsuarioId),
            new Claim(ClaimTypes.Role, RolesUsuario.Conductor)
        ], "Test"));
        var groups = new RecordingGroupManager();
        var hub = new ViajeHub(
            factory.Services.GetRequiredService<AppDbContext>(),
            factory.Services.GetRequiredService<IConductoresActivosTracker>())
        {
            Context = new TestHubCallerContext(principal),
            Groups = groups
        };

        var attempt = async () => await hub.EstablecerDisponibilidad(true);
        await attempt.Should().ThrowAsync<HubException>();
        groups.AddedGroups.Should().BeEmpty();

        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await dbContext.Users
                .Where(usuario => usuario.Id == driver.UsuarioId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(
                    usuario => usuario.EstadoVerificacion,
                    EstadoVerificacionConductor.Aprobado));
        }

        await hub.EstablecerDisponibilidad(true);
        groups.AddedGroups.Should().ContainSingle(ViajeHub.GrupoConductores);
    }

    private static async Task<AuthResponse> LoginAsync(HttpClient client, string email, string password)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/login", new { Email = email, Password = password });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>();
        auth.Should().NotBeNull();
        return auth!;
    }

    private static async Task<HttpResponseMessage> UploadDocumentAsync(
        HttpClient client,
        string token,
        string tipoDocumento)
    {
        using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.ASCII.GetBytes("%PDF-1.7\nE2E"));
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        content.Add(file, "Archivo", $"{tipoDocumento}.pdf");
        content.Add(new StringContent(tipoDocumento), "TipoDocumento");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/conductor/subir-documento")
        {
            Content = content
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
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

    private static async Task<HttpResponseMessage> PutAuthorizedAsync(
        HttpClient client,
        string path,
        string token,
        object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
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

    private static decimal EstimatePrice(
        (double Latitude, double Longitude) origin,
        (double Latitude, double Longitude) firstStop,
        (double Latitude, double Longitude) secondStop,
        (double Latitude, double Longitude) destination)
    {
        var waypoints = new[] { origin, firstStop, secondStop, destination };
        var distanceKm = 0d;
        for (var index = 1; index < waypoints.Length; index++)
        {
            var previous = waypoints[index - 1];
            var current = waypoints[index];
            var latitude1 = previous.Latitude * Math.PI / 180d;
            var latitude2 = current.Latitude * Math.PI / 180d;
            var latitudeDelta = (current.Latitude - previous.Latitude) * Math.PI / 180d;
            var longitudeDelta = (current.Longitude - previous.Longitude) * Math.PI / 180d;
            var haversine = Math.Pow(Math.Sin(latitudeDelta / 2), 2)
                + Math.Cos(latitude1) * Math.Cos(latitude2)
                * Math.Pow(Math.Sin(longitudeDelta / 2), 2);
            distanceKm += 2 * 6371 * Math.Asin(Math.Sqrt(haversine));
        }

        var estimate = 5000m + (decimal)(distanceKm * 1.3) * 1800m;
        return decimal.Ceiling(estimate / 500m) * 500m;
    }

    private sealed class RecordingGroupManager : IGroupManager
    {
        public List<string> AddedGroups { get; } = [];

        public Task AddToGroupAsync(
            string connectionId,
            string groupName,
            CancellationToken cancellationToken = default)
        {
            AddedGroups.Add(groupName);
            return Task.CompletedTask;
        }

        public Task RemoveFromGroupAsync(
            string connectionId,
            string groupName,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class TestHubCallerContext(ClaimsPrincipal user) : HubCallerContext
    {
        public override string ConnectionId => "test-connection";

        public override string? UserIdentifier => user.FindFirstValue(ClaimTypes.NameIdentifier);

        public override ClaimsPrincipal User => user;

        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();

        public override IFeatureCollection Features { get; } = new FeatureCollection();

        public override CancellationToken ConnectionAborted => CancellationToken.None;

        public override void Abort()
        {
        }
    }
}
