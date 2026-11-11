using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace GpsSystem.Tests;

public sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
{
    private const string TestJwtSecret = "integration-test-secret-key-at-least-32-bytes";
    private const string TestDatabaseUrl = "Host=localhost;Database=unused;Username=test;Password=test;";
    private static readonly object EnvironmentLock = new();
    private readonly SqliteConnection _connection = new("Data Source=:memory:");

    protected override IHost CreateHost(IHostBuilder builder)
    {
        lock (EnvironmentLock)
        {
            var previousJwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET");
            var previousDatabaseUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
            Environment.SetEnvironmentVariable("JWT_SECRET", TestJwtSecret);
            Environment.SetEnvironmentVariable("DATABASE_URL", TestDatabaseUrl);
            try
            {
                return base.CreateHost(builder);
            }
            finally
            {
                Environment.SetEnvironmentVariable("JWT_SECRET", previousJwtSecret);
                Environment.SetEnvironmentVariable("DATABASE_URL", previousDatabaseUrl);
            }
        }
    }

    public TestWebApplicationFactory()
    {
        _connection.Open();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JWT_SECRET"] = TestJwtSecret,
                ["ConnectionStrings:DefaultConnection"] = TestDatabaseUrl
            }));
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.RemoveAll<AppDbContext>();
            services.AddDbContext<AppDbContext>(options => options.UseSqlite(_connection));
        });
    }

    public async Task InitializeDatabaseAsync()
    {
        using var scope = Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await dbContext.Database.EnsureCreatedAsync();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        foreach (var role in new[] { RolesUsuario.Pasajero, RolesUsuario.Conductor })
        {
            if (!await roleManager.RoleExistsAsync(role))
            {
                var result = await roleManager.CreateAsync(new IdentityRole(role));
                if (!result.Succeeded)
                {
                    throw new InvalidOperationException(
                        $"No se pudo crear el rol de prueba {role}: " +
                        string.Join("; ", result.Errors.Select(error => error.Description)));
                }
            }
        }
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            _connection.Dispose();
        }
    }
}
