using GpsSystem.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;

namespace GpsSystem.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<Usuario>(options)
{
    public DbSet<Dispositivo> Dispositivos => Set<Dispositivo>();

    public DbSet<Ubicacion> Ubicaciones => Set<Ubicacion>();

    public DbSet<PerfilConductor> PerfilesConductores => Set<PerfilConductor>();

    public DbSet<Viaje> Viajes => Set<Viaje>();

    public DbSet<Mensaje> Mensajes => Set<Mensaje>();

    public DbSet<Transaccion> Transacciones => Set<Transaccion>();

    public DbSet<TokenNotificacion> TokensNotificacion => Set<TokenNotificacion>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Ubicacion>()
            .HasOne(ubicacion => ubicacion.Dispositivo)
            .WithMany(dispositivo => dispositivo.Ubicaciones)
            .HasForeignKey(ubicacion => ubicacion.DispositivoId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Ubicacion>()
            .HasIndex(ubicacion => new { ubicacion.DispositivoId, ubicacion.FechaHora });

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.Rol)
            .HasMaxLength(20)
            .IsRequired();

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.Nombre)
            .HasMaxLength(100)
            .IsRequired();

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.ResetCode)
            .HasMaxLength(6);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.Telefono)
            .HasMaxLength(32)
            .IsRequired();

        modelBuilder.Entity<PerfilConductor>()
            .HasOne(perfil => perfil.Usuario)
            .WithOne(usuario => usuario.PerfilConductor)
            .HasForeignKey<PerfilConductor>(perfil => perfil.UsuarioId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PerfilConductor>()
            .HasIndex(perfil => perfil.Placa)
            .IsUnique();

        modelBuilder.Entity<Viaje>()
            .HasOne(viaje => viaje.Pasajero)
            .WithMany()
            .HasForeignKey(viaje => viaje.PasajeroId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Viaje>()
            .HasOne(viaje => viaje.Conductor)
            .WithMany()
            .HasForeignKey(viaje => viaje.ConductorId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Viaje>()
            .HasIndex(viaje => new { viaje.Estado, viaje.FechaCreacion });

        modelBuilder.Entity<Mensaje>()
            .HasOne(mensaje => mensaje.Viaje)
            .WithMany(viaje => viaje.Mensajes)
            .HasForeignKey(mensaje => mensaje.ViajeId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Mensaje>()
            .HasOne(mensaje => mensaje.Remitente)
            .WithMany()
            .HasForeignKey(mensaje => mensaje.RemitenteId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Transaccion>()
            .HasOne(transaccion => transaccion.Viaje)
            .WithMany()
            .HasForeignKey(transaccion => transaccion.ViajeId)
            .OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<Transaccion>()
            .HasIndex(transaccion => transaccion.ViajeId)
            .IsUnique();

        modelBuilder.Entity<TokenNotificacion>()
            .HasOne(token => token.Usuario)
            .WithMany()
            .HasForeignKey(token => token.UsuarioId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<TokenNotificacion>()
            .HasIndex(token => token.Token)
            .IsUnique();

        modelBuilder.Entity<TokenNotificacion>()
            .HasIndex(token => token.UsuarioId);
    }
}
