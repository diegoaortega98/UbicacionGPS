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

    public DbSet<Promocion> Promociones => Set<Promocion>();

    public DbSet<ParadaViaje> ParadasViaje => Set<ParadaViaje>();

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

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.PromedioCalificacion)
            .HasDefaultValue(5.0);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.TotalCalificaciones)
            .HasDefaultValue(0);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.DireccionCasa)
            .HasMaxLength(300);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.DireccionTrabajo)
            .HasMaxLength(300);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.UrlLicencia)
            .HasMaxLength(64);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.UrlSOAT)
            .HasMaxLength(64);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.UrlTarjetaPropiedad)
            .HasMaxLength(64);

        modelBuilder.Entity<Usuario>()
            .Property(usuario => usuario.MotivoRechazo)
            .HasMaxLength(500);

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

        modelBuilder.Entity<Viaje>()
            .HasOne(viaje => viaje.Promocion)
            .WithMany()
            .HasForeignKey(viaje => viaje.PromocionId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<ParadaViaje>()
            .HasOne(parada => parada.Viaje)
            .WithMany(viaje => viaje.Paradas)
            .HasForeignKey(parada => parada.ViajeId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ParadaViaje>()
            .HasIndex(parada => new { parada.ViajeId, parada.Orden })
            .IsUnique();

        modelBuilder.Entity<Promocion>()
            .Property(promocion => promocion.PorcentajeDescuento)
            .HasPrecision(5, 2);

        modelBuilder.Entity<Promocion>()
            .HasIndex(promocion => promocion.Codigo)
            .IsUnique();

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
