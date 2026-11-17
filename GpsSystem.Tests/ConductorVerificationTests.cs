using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using FluentAssertions;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GpsSystem.Tests;

public sealed class ConductorVerificationTests
{
    [Fact]
    public async Task DriverMustSubmitAndGetDocumentsApprovedBeforeAcceptingTrips()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var suffix = Guid.NewGuid().ToString("N");
        const string password = "Verification!2026";

        using var passengerRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = $"passenger-verification-{suffix}@example.com",
            Password = password,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        passengerRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var passenger = await passengerRegistration.Content.ReadFromJsonAsync<AuthResponse>();
        passenger.Should().NotBeNull();

        using var driverRegistration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = $"driver-verification-{suffix}@example.com",
            Password = password,
            Telefono = "5559876543",
            Rol = RolesUsuario.Conductor,
            Vehiculo = "Sedan",
            Placa = $"V{suffix[..7]}"
        });
        driverRegistration.StatusCode.Should().Be(HttpStatusCode.OK);
        var driver = await driverRegistration.Content.ReadFromJsonAsync<AuthResponse>();
        driver.Should().NotBeNull();

        string adminToken;
        using (var scope = factory.Services.CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<Usuario>>();
            var tokenService = scope.ServiceProvider.GetRequiredService<ITokenService>();
            var admin = new Usuario
            {
                UserName = $"admin-verification-{suffix}@example.com",
                Email = $"admin-verification-{suffix}@example.com",
                Nombre = "Admin",
                Telefono = "5550000000",
                Rol = RolesUsuario.Admin
            };
            (await userManager.CreateAsync(admin, "AdminVerification!2026")).Succeeded.Should().BeTrue();
            (await userManager.AddToRoleAsync(admin, RolesUsuario.Admin)).Succeeded.Should().BeTrue();
            adminToken = tokenService.CrearToken(admin);
        }

        using var rideResponse = await PostAuthorizedAsync(client, "/api/viajes/solicitar", passenger!.Token, new
        {
            OrigenLat = 10.391,
            OrigenLng = -75.4794,
            DestinoLat = 10.412,
            DestinoLng = -75.51
        });
        rideResponse.StatusCode.Should().Be(HttpStatusCode.Created);
        var ride = await rideResponse.Content.ReadFromJsonAsync<SolicitudViajeResponse>();
        ride.Should().NotBeNull();

        using var unverifiedAccept = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{ride!.Id}/aceptar",
            driver!.Token);
        unverifiedAccept.StatusCode.Should().Be(HttpStatusCode.Conflict);

        using var incompleteSubmission = await PostAuthorizedAsync(
            client,
            "/api/conductor/enviar-verificacion",
            driver.Token);
        incompleteSubmission.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        foreach (var tipoDocumento in new[] { "Licencia", "SOAT", "TarjetaPropiedad" })
        {
            using var upload = await UploadDocumentAsync(client, driver.Token, tipoDocumento);
            upload.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        using var submission = await PostAuthorizedAsync(
            client,
            "/api/conductor/enviar-verificacion",
            driver.Token);
        submission.StatusCode.Should().Be(HttpStatusCode.OK);

        using var pendingResponse = await GetAuthorizedAsync(
            client,
            "/api/admin/conductores-pendientes",
            adminToken);
        pendingResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var pendingDrivers = await pendingResponse.Content.ReadFromJsonAsync<List<ConductorPendienteResponse>>();
        pendingDrivers.Should().ContainSingle(item => item.Id == driver.UsuarioId);

        using var protectedDocument = await GetAuthorizedAsync(
            client,
            pendingDrivers![0].UrlLicencia,
            adminToken);
        protectedDocument.StatusCode.Should().Be(HttpStatusCode.OK);
        (await protectedDocument.Content.ReadAsByteArrayAsync()).Take(5)
            .Should().Equal(Encoding.ASCII.GetBytes("%PDF-"));

        using var driverDocumentAccess = await GetAuthorizedAsync(
            client,
            pendingDrivers[0].UrlLicencia,
            driver.Token);
        driverDocumentAccess.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        using var rejectWithoutReason = await PostAuthorizedAsync(
            client,
            $"/api/admin/verificar-conductor/{driver.UsuarioId}",
            adminToken,
            new { Aprobado = false });
        rejectWithoutReason.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var reject = await PostAuthorizedAsync(
            client,
            $"/api/admin/verificar-conductor/{driver.UsuarioId}",
            adminToken,
            new { Aprobado = false, MotivoRechazo = "La licencia no es legible." });
        reject.StatusCode.Should().Be(HttpStatusCode.OK);
        var rejected = await reject.Content.ReadFromJsonAsync<EstadoVerificacionConductorResponse>();
        rejected.Should().NotBeNull();
        rejected!.EstadoVerificacion.Should().Be("Rechazado");
        rejected.MotivoRechazo.Should().Be("La licencia no es legible.");

        using var rejectedProfileResponse = await GetAuthorizedAsync(
            client,
            "/api/auth/perfil",
            driver.Token);
        var rejectedProfile = await rejectedProfileResponse.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        rejectedProfile.Should().NotBeNull();
        rejectedProfile!.EstadoVerificacion.Should().Be("Rechazado");
        rejectedProfile.MotivoRechazo.Should().Be("La licencia no es legible.");

        using var resubmission = await UploadDocumentAsync(client, driver.Token, "Licencia");
        resubmission.StatusCode.Should().Be(HttpStatusCode.OK);
        using var resend = await PostAuthorizedAsync(client, "/api/conductor/enviar-verificacion", driver.Token);
        resend.StatusCode.Should().Be(HttpStatusCode.OK);

        using var approve = await PostAuthorizedAsync(
            client,
            $"/api/admin/verificar-conductor/{driver.UsuarioId}",
            adminToken,
            new
            {
                Aprobado = true,
                FechaVencimientoDocumentos = DateTime.UtcNow.Date.AddMonths(6)
            });
        approve.StatusCode.Should().Be(HttpStatusCode.OK);
        var approved = await approve.Content.ReadFromJsonAsync<EstadoVerificacionConductorResponse>();
        approved.Should().NotBeNull();
        approved!.FechaVencimientoDocumentos.Should().NotBeNull();

        using var acceptedRide = await PostAuthorizedAsync(
            client,
            $"/api/viajes/{ride.Id}/aceptar",
            driver.Token);
        acceptedRide.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await dbContext.Users
                .Where(usuario => usuario.Id == driver.UsuarioId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(
                    usuario => usuario.FechaVencimientoDocumentos,
                    DateTime.UtcNow.Date.AddDays(-1)));
        }

        using var expiredDriversResponse = await GetAuthorizedAsync(
            client,
            "/api/admin/conductores-vencidos",
            adminToken);
        expiredDriversResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        var expiredDrivers = await expiredDriversResponse.Content.ReadFromJsonAsync<List<ConductorVencidoResponse>>();
        expiredDrivers.Should().ContainSingle(item => item.Id == driver.UsuarioId);

        using var expiredProfileResponse = await GetAuthorizedAsync(
            client,
            "/api/auth/perfil",
            driver.Token);
        var expiredProfile = await expiredProfileResponse.Content.ReadFromJsonAsync<PerfilUsuarioResponse>();
        expiredProfile.Should().NotBeNull();
        expiredProfile!.EstadoVerificacion.Should().Be("Vencido");
    }

    private static async Task<HttpResponseMessage> UploadDocumentAsync(
        HttpClient client,
        string token,
        string tipoDocumento)
    {
        using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.ASCII.GetBytes("%PDF-1.7\nDocumento de prueba"));
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
