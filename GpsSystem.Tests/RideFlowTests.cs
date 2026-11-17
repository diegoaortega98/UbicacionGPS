using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

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
        passengerAuth.Telefono.Should().Be("5551234567");

        using var profileResponse = await GetAuthorizedAsync(
            client,
            "/api/auth/perfil",
            passengerAuth.Token);
        profileResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var profile = await profileResponse.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        profile.Should().NotBeNull();
        profile!.Telefono.Should().Be(passengerAuth.Telefono);
        profile.PromedioCalificacion.Should().Be(5.0);
        profile.TotalCalificaciones.Should().Be(0);

        using var driverLogin = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = driverEmail,
            Password = password
        });
        driverLogin.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverAuth = await driverLogin.Content.ReadFromJsonAsync<AuthResponse>();
        driverAuth.Should().NotBeNull();
        driverAuth!.Token.Should().NotBeNullOrWhiteSpace();
        driverAuth.Telefono.Should().Be("5559876543");

        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await dbContext.Users
                .Where(usuario => usuario.Id == driverAuth.UsuarioId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(
                    usuario => usuario.EstadoVerificacion,
                    EstadoVerificacionConductor.Aprobado));
        }

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

        using var prematureRating = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/calificar",
            passengerAuth.Token,
            new { Estrellas = 5 });
        prematureRating.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            dbContext.Viajes.Add(new Viaje
            {
                PasajeroId = passengerAuth.UsuarioId,
                OrigenLat = 19.4326,
                OrigenLng = -99.1332,
                DestinoLat = 19.4270,
                DestinoLng = -99.1276,
                FechaCreacion = DateTimeOffset.UtcNow.AddMinutes(-11)
            });
            await dbContext.SaveChangesAsync();
        }

        using var pendingRides = await GetAuthorizedAsync(
            client,
            "/api/viajes/pendientes",
            driverAuth.Token);
        pendingRides.StatusCode.Should().Be(HttpStatusCode.OK);
        var pending = await pendingRides.Content.ReadFromJsonAsync<List<ViajeResponse>>();
        pending.Should().ContainSingle(trip => trip.Id == rideRequest.Id);
        pending![0].PasajeroNombre.Should().Be(passengerEmail);

        using var rejectRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/rechazar",
            driverAuth.Token);
        rejectRide.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var acceptRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/aceptar",
            driverAuth.Token);
        acceptRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var acceptedTrip = await acceptRide.Content.ReadFromJsonAsync<ViajeResponse>();
        acceptedTrip.Should().NotBeNull();
        acceptedTrip!.ConductorNombre.Should().Be(driverEmail);
        acceptedTrip.ConductorTelefono.Should().Be("5559876543");

        using var arrivingRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/llegando",
            driverAuth.Token);
        arrivingRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var arrivedTrip = await arrivingRide.Content.ReadFromJsonAsync<ViajeResponse>();
        arrivedTrip.Should().NotBeNull();
        arrivedTrip!.Estado.Should().Be(EstadosViaje.Llegando);

        using var startRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/iniciar",
            driverAuth.Token,
            new { Pin = rideRequest.Pin });
        startRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var startedRide = await startRide.Content.ReadFromJsonAsync<ViajeResponse>();
        startedRide.Should().NotBeNull();
        startedRide!.Estado.Should().Be(EstadosViaje.EnCurso);

        using var finishRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/finalizar",
            driverAuth.Token);
        finishRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var finalization = await finishRide.Content.ReadFromJsonAsync<FinalizacionViajeResponse>();
        finalization.Should().NotBeNull();
        finalization!.Viaje.Estado.Should().Be(EstadosViaje.PendientePago);
        finalization.MontoTotal.Should().Be(finalization.Viaje.Precio);
        finalization.Comision.Should().Be(decimal.Round(
            finalization.MontoTotal * 0.15m, 2, MidpointRounding.AwayFromZero));
        finalization.GananciaNeta.Should().Be(finalization.MontoTotal - finalization.Comision);

        using var paymentReceived = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/pago-recibido",
            driverAuth.Token);
        paymentReceived.StatusCode.Should().Be(HttpStatusCode.OK);
        var completedRide = await paymentReceived.Content.ReadFromJsonAsync<ViajeResponse>();
        completedRide.Should().NotBeNull();
        completedRide!.Estado.Should().Be(EstadosViaje.Finalizado);

        using var invalidRating = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/calificar",
            passengerAuth.Token,
            new { Estrellas = 6 });
        invalidRating.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var rateRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/calificar",
            passengerAuth.Token,
            new { Estrellas = 4, Comentario = "Buen viaje" });
        rateRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var ratedRide = await rateRide.Content.ReadFromJsonAsync<ViajeResponse>();
        ratedRide.Should().NotBeNull();
        ratedRide!.Calificacion.Should().Be(4);
        ratedRide.ComentarioCalificacion.Should().Be("Buen viaje");

        using var driverRating = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/calificar",
            driverAuth.Token,
            new { Estrellas = 5 });
        driverRating.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var duplicateRating = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{rideRequest.Id}/calificar",
            passengerAuth.Token,
            new { Estrellas = 5 });
        duplicateRating.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using var driverProfileResponse = await GetAuthorizedAsync(
            client,
            "/api/auth/perfil",
            driverAuth.Token);
        driverProfileResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverProfile = await driverProfileResponse.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        driverProfile.Should().NotBeNull();
        driverProfile!.PromedioCalificacion.Should().Be(4.0);
        driverProfile.TotalCalificaciones.Should().Be(1);

        using var passengerHistoryResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial",
            passengerAuth.Token);
        passengerHistoryResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var passengerHistory = await passengerHistoryResponse.Content.ReadFromJsonAsync<List<ViajeResponse>>();
        passengerHistory.Should().ContainSingle(trip => trip.Id == rideRequest.Id && trip.Calificacion == 4);

        using var driverHistoryResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial",
            driverAuth.Token);
        driverHistoryResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverHistory = await driverHistoryResponse.Content.ReadFromJsonAsync<List<ViajeResponse>>();
        driverHistory.Should().ContainSingle(trip => trip.Id == rideRequest.Id && trip.Calificacion == 4);

        using var earningsResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/ganancias",
            driverAuth.Token);
        earningsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var earnings = await earningsResponse.Content.ReadFromJsonAsync<GananciasResponse>();
        earnings.Should().NotBeNull();
        earnings!.GananciasAcumuladas.Should().Be(finalization.GananciaNeta);

        using var driverWalletResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial-conductor",
            driverAuth.Token);
        driverWalletResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverWallet = await driverWalletResponse.Content
            .ReadFromJsonAsync<List<HistorialViajeConductorResponse>>();
        driverWallet.Should().ContainSingle();
        driverWallet![0].ViajeId.Should().Be(rideRequest.Id);
        driverWallet[0].Fecha.Should().NotBe(default);
        driverWallet[0].MontoTotal.Should().Be(finalization.MontoTotal);
        driverWallet[0].Comision.Should().Be(finalization.Comision);
        driverWallet[0].GananciaNeta.Should().Be(finalization.GananciaNeta);

        using var passengerWalletResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial-conductor",
            passengerAuth.Token);
        passengerWalletResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var secondRequest = await PostAuthorizedAsync(client, "/api/viajes/solicitar", passengerAuth.Token, new
        {
            OrigenLat = 19.4326,
            OrigenLng = -99.1332,
            DestinoLat = 19.4270,
            DestinoLng = -99.1276
        });
        secondRequest.StatusCode.Should().Be(HttpStatusCode.Created);
        var secondRide = await secondRequest.Content.ReadFromJsonAsync<SolicitudViajeResponse>();
        secondRide.Should().NotBeNull();

        using var cancelRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{secondRide!.Id}/cancelar",
            passengerAuth.Token);
        cancelRide.StatusCode.Should().Be(HttpStatusCode.OK);
        var cancelledRide = await cancelRide.Content.ReadFromJsonAsync<ViajeResponse>();
        cancelledRide.Should().NotBeNull();
        cancelledRide!.Estado.Should().Be(EstadosViaje.Cancelado);

        using var thirdRequest = await PostAuthorizedAsync(client, "/api/viajes/solicitar", passengerAuth.Token, new
        {
            OrigenLat = 19.4326,
            OrigenLng = -99.1332,
            DestinoLat = 19.4270,
            DestinoLng = -99.1276
        });
        thirdRequest.StatusCode.Should().Be(HttpStatusCode.Created);
        var thirdRide = await thirdRequest.Content.ReadFromJsonAsync<SolicitudViajeResponse>();
        thirdRide.Should().NotBeNull();

        using var acceptThirdRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{thirdRide!.Id}/aceptar",
            driverAuth.Token);
        acceptThirdRide.StatusCode.Should().Be(HttpStatusCode.OK);

        using var driverCancel = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{thirdRide.Id}/cancelar",
            driverAuth.Token);
        driverCancel.StatusCode.Should().Be(HttpStatusCode.OK);
        var driverCancelledRide = await driverCancel.Content.ReadFromJsonAsync<ViajeResponse>();
        driverCancelledRide.Should().NotBeNull();
        driverCancelledRide!.Estado.Should().Be(EstadosViaje.Cancelado);
        driverCancelledRide.ConductorId.Should().Be(driverAuth.UsuarioId);
    }

    [Fact]
    public async Task RegistrationRejectsMissingPhone()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();

        using var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = $"no-phone-{Guid.NewGuid():N}@example.com",
            Password = "NoPhone!2026",
            Telefono = " ",
            Rol = RolesUsuario.Pasajero
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task ProfileCanBeUpdatedAndPasswordChangeRequiresCurrentPassword()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var email = $"profile-{Guid.NewGuid():N}@example.com";
        const string currentPassword = "Profile!2026";
        const string newPassword = "Changed!2026";

        using var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = email,
            Password = currentPassword,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        registration.StatusCode.Should().Be(HttpStatusCode.OK);

        using var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = email,
            Password = currentPassword
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);
        var account = await login.Content.ReadFromJsonAsync<AuthResponse>();
        account.Should().NotBeNull();

        using var unauthenticatedUpdate = await client.PutAsJsonAsync("/api/auth/perfil", new
        {
            Nombre = "Ana",
            Telefono = "5557654321"
        });
        unauthenticatedUpdate.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var missingCurrentPassword = await PutAuthorizedAsync(client, "/api/auth/perfil", account!.Token, new
        {
            Nombre = "Ana",
            Telefono = "5557654321",
            PasswordNueva = newPassword
        });
        missingCurrentPassword.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var invalidCurrentPassword = await PutAuthorizedAsync(client, "/api/auth/perfil", account.Token, new
        {
            Nombre = "Ana",
            Telefono = "5557654321",
            PasswordActual = "Wrong!2026",
            PasswordNueva = newPassword
        });
        invalidCurrentPassword.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var update = await PutAuthorizedAsync(client, "/api/auth/perfil", account.Token, new
        {
            Nombre = "Ana Ortega",
            Telefono = "5557654321",
            PasswordActual = currentPassword,
            PasswordNueva = newPassword
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var profile = await update.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        profile.Should().Be(new PerfilUsuarioResponse(
            "Ana Ortega", "5557654321", 5.0, 0, null, null, null, null, null, null,
            "Pendiente", null, false, false, false));

        using var updatedLogin = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = email,
            Password = newPassword
        });
        updatedLogin.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task PassengerCanSaveAndReadFavoritePlaces()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var email = $"favorites-{Guid.NewGuid():N}@example.com";
        const string password = "Favorites!2026";

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

        using var unauthenticatedUpdate = await client.PutAsJsonAsync("/api/auth/lugares-favoritos", new
        {
            DireccionCasa = "Casa",
            LatCasa = 10.391,
            LngCasa = -75.4794
        });
        unauthenticatedUpdate.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var incompletePlace = await PutAuthorizedAsync(
            client,
            "/api/auth/lugares-favoritos",
            account!.Token,
            new
            {
                DireccionCasa = "Casa",
                LatCasa = 10.391,
                LngCasa = (double?)null
            });
        incompletePlace.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var update = await PutAuthorizedAsync(client, "/api/auth/lugares-favoritos", account.Token, new
        {
            DireccionCasa = "  Casa de Ana  ",
            LatCasa = 10.391,
            LngCasa = -75.4794,
            DireccionTrabajo = "Oficina de Ana",
            LatTrabajo = 10.412,
            LngTrabajo = -75.51
        });
        update.StatusCode.Should().Be(HttpStatusCode.OK);
        var profile = await update.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        profile.Should().NotBeNull();
        profile!.DireccionCasa.Should().Be("Casa de Ana");
        profile.LatCasa.Should().Be(10.391);
        profile.LngCasa.Should().Be(-75.4794);
        profile.DireccionTrabajo.Should().Be("Oficina de Ana");
        profile.LatTrabajo.Should().Be(10.412);
        profile.LngTrabajo.Should().Be(-75.51);

        using var profileResponse = await GetAuthorizedAsync(client, "/api/auth/perfil", account.Token);
        profileResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var savedProfile = await profileResponse.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        savedProfile.Should().Be(profile);
    }

    [Fact]
    public async Task PassengerHistoryAndStatisticsAreScopedAndLimitedToFinalizedTrips()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var suffix = Guid.NewGuid().ToString("N");
        const string password = "PassengerHistory!2026";

        using var passengerRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = $"passenger-history-{suffix}@example.com",
            Password = password,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        passengerRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var passenger = await passengerRegistration.Content.ReadFromJsonAsync<AuthResponse>();
        passenger.Should().NotBeNull();

        using var driverRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = $"driver-history-{suffix}@example.com",
            Password = password,
            Telefono = "5559876543",
            Rol = RolesUsuario.Conductor,
            Vehiculo = "Sedan",
            Placa = $"H{suffix[..7]}"
        });
        driverRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var driver = await driverRegistration.Content.ReadFromJsonAsync<AuthResponse>();
        driver.Should().NotBeNull();

        using var otherPassengerRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = $"other-history-{suffix}@example.com",
            Password = password,
            Telefono = "5557654321",
            Rol = RolesUsuario.Pasajero
        });
        otherPassengerRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var otherPassenger = await otherPassengerRegistration.Content.ReadFromJsonAsync<AuthResponse>();
        otherPassenger.Should().NotBeNull();

        var firstDate = new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var driverUser = await dbContext.Users.SingleAsync(user => user.Id == driver!.UsuarioId);
            driverUser.Nombre = "Carlos Conductor";

            for (var index = 0; index < 51; index++)
            {
                var date = firstDate.AddDays(index);
                dbContext.Viajes.Add(new Viaje
                {
                    PasajeroId = passenger!.UsuarioId,
                    ConductorId = driver.UsuarioId,
                    Estado = EstadosViaje.Finalizado,
                    OrigenLat = 10 + index,
                    OrigenLng = -75,
                    DestinoLat = 11 + index,
                    DestinoLng = -74,
                    Precio = index == 50 ? 8.25m : 10m,
                    FechaCreacion = date,
                    FechaFinalizacion = date.AddMinutes(5)
                });
            }

            dbContext.Viajes.Add(new Viaje
            {
                PasajeroId = passenger!.UsuarioId,
                Estado = EstadosViaje.Cancelado,
                Precio = 1_000m,
                FechaCreacion = firstDate.AddDays(60)
            });
            dbContext.Viajes.Add(new Viaje
            {
                PasajeroId = otherPassenger!.UsuarioId,
                ConductorId = driver.UsuarioId,
                Estado = EstadosViaje.Finalizado,
                Precio = 500m,
                FechaCreacion = firstDate.AddDays(61),
                FechaFinalizacion = firstDate.AddDays(61).AddMinutes(5)
            });
            await dbContext.SaveChangesAsync();
        }

        using var unauthorized = await client.GetAsync("/api/viajes/historial-pasajero");
        unauthorized.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var forbidden = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial-pasajero",
            driver!.Token);
        forbidden.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var historyResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/historial-pasajero",
            passenger!.Token);
        historyResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var history = await historyResponse.Content.ReadFromJsonAsync<List<HistorialViajePasajeroResponse>>();
        history.Should().HaveCount(50);
        history![0].Fecha.Should().Be(firstDate.AddDays(50).AddMinutes(5));
        history[0].DestinoLat.Should().Be(61);
        history[0].MontoPagado.Should().Be(8.25m);
        history[0].ConductorNombre.Should().Be("Carlos Conductor");

        using var statisticsResponse = await GetAuthorizedAsync(
            client,
            "/api/viajes/estadisticas-pasajero",
            passenger.Token);
        statisticsResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var statistics = await statisticsResponse.Content.ReadFromJsonAsync<EstadisticasPasajeroResponse>();
        statistics.Should().Be(new EstadisticasPasajeroResponse(51, 508.25m));
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
        using var request = new HttpRequestMessage(HttpMethod.Put, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(body);
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
}
