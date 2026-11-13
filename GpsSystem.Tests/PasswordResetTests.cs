using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GpsSystem.Tests;

public sealed class PasswordResetTests
{
    [Fact]
    public async Task PasswordResetRequiresValidUnexpiredCodeAndInvalidatesItAfterUse()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        await factory.InitializeDatabaseAsync();
        var email = $"reset-{Guid.NewGuid():N}@example.com";
        const string currentPassword = "Current!2026";
        const string newPassword = "Updated!2026";

        using var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            Email = email,
            Password = currentPassword,
            Telefono = "5551234567",
            Rol = RolesUsuario.Pasajero
        });
        registration.StatusCode.Should().Be(HttpStatusCode.OK);

        using var requestCode = await client.PostAsJsonAsync("/api/auth/forgot-password", new { Email = email });
        requestCode.StatusCode.Should().Be(HttpStatusCode.OK);

        string resetCode;
        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await dbContext.Users.SingleAsync(account => account.Email == email);
            resetCode = user.ResetCode!;
            resetCode.Should().MatchRegex("^\\d{6}$");
            user.ResetCodeExpiration.Should().BeAfter(DateTime.UtcNow.AddMinutes(14));
            user.ResetCodeExpiration.Should().BeBefore(DateTime.UtcNow.AddMinutes(16));
        }

        var invalidCode = resetCode == "000000" ? "000001" : "000000";
        using var invalidReset = await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            Email = email,
            Codigo = invalidCode,
            PasswordNueva = newPassword
        });
        invalidReset.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await dbContext.Users.SingleAsync(account => account.Email == email);
            user.ResetCodeExpiration = DateTime.UtcNow.AddMinutes(-1);
            await dbContext.SaveChangesAsync();
        }

        using var expiredReset = await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            Email = email,
            Codigo = resetCode,
            PasswordNueva = newPassword
        });
        expiredReset.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        using var secondRequestCode = await client.PostAsJsonAsync(
            "/api/auth/forgot-password", new { Email = email });
        secondRequestCode.StatusCode.Should().Be(HttpStatusCode.OK);
        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            resetCode = (await dbContext.Users.SingleAsync(account => account.Email == email)).ResetCode!;
        }

        using var successfulReset = await client.PostAsJsonAsync("/api/auth/reset-password", new
        {
            Email = email,
            Codigo = resetCode,
            PasswordNueva = newPassword
        });
        successfulReset.StatusCode.Should().Be(HttpStatusCode.OK);

        using var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            Email = email,
            Password = newPassword
        });
        login.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var scope = factory.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await dbContext.Users.SingleAsync(account => account.Email == email);
            user.ResetCode.Should().BeNull();
            user.ResetCodeExpiration.Should().BeNull();
        }
    }
}
