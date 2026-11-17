using GpsSystem.Api.Data;
using GpsSystem.Api.Models;
using GpsSystem.Api.Services;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.Http;
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
            services.RemoveAll<IDocumentoConductorStorage>();
            services.AddSingleton<IDocumentoConductorStorage, InMemoryDocumentoConductorStorage>();
            services.RemoveAll<IEmailService>();
            services.AddSingleton<TestEmailService>();
            services.AddSingleton<IEmailService>(provider => provider.GetRequiredService<TestEmailService>());
        });
    }

    public async Task InitializeDatabaseAsync()
    {
        using var scope = Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await dbContext.Database.EnsureCreatedAsync();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        foreach (var role in new[] { RolesUsuario.Pasajero, RolesUsuario.Conductor, RolesUsuario.Admin })
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

    internal sealed class InMemoryDocumentoConductorStorage : IDocumentoConductorStorage
    {
        private readonly Dictionary<string, byte[]> _archivos = new(StringComparer.Ordinal);

        public async Task<string> GuardarAsync(IFormFile archivo, CancellationToken cancellationToken)
        {
            await using var contenido = new MemoryStream();
            await archivo.CopyToAsync(contenido, cancellationToken);
            var extension = Path.GetExtension(archivo.FileName).ToLowerInvariant();
            var clave = $"{Guid.NewGuid():N}{extension}";
            _archivos[clave] = contenido.ToArray();
            return clave;
        }

        public Task<DocumentoConductorArchivo?> AbrirAsync(
            string? clave,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (clave is null || !_archivos.TryGetValue(clave, out var contenido))
            {
                return Task.FromResult<DocumentoConductorArchivo?>(null);
            }

            var contentType = Path.GetExtension(clave).ToLowerInvariant() switch
            {
                ".pdf" => "application/pdf",
                ".png" => "image/png",
                _ => "image/jpeg"
            };
            return Task.FromResult<DocumentoConductorArchivo?>(
                new DocumentoConductorArchivo(new MemoryStream(contenido, writable: false), contentType, clave));
        }

        public Task EliminarAsync(string? clave, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (clave is not null)
            {
                _archivos.Remove(clave);
            }

            return Task.CompletedTask;
        }

        public Task<bool> ExisteAsync(string? clave, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(clave is not null && _archivos.ContainsKey(clave));
        }
    }

    internal sealed class TestEmailService : IEmailService
    {
        private readonly ConcurrentQueue<(string Email, string Codigo)> _correos = new();

        public IReadOnlyCollection<(string Email, string Codigo)> Correos => _correos.ToArray();

        public Task EnviarCodigoRecuperacionAsync(
            string email,
            string codigo,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _correos.Enqueue((email, codigo));
            return Task.CompletedTask;
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
