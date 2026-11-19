package api

import (
	"context"
	"time"

	"github.com/memries/memries/internal/db"
)

type Library interface {
	GetPhoto(ctx context.Context, viewer, key string) (*db.Photo, error)
	PhotosFiltered(ctx context.Context, viewer string, from, to time.Time, limit int, cursor string, filter db.PhotoFilter) ([]db.Photo, string, error)
	Timeline(ctx context.Context, granularity string, from, to time.Time) ([]db.Bucket, error)
	SetFavorite(ctx context.Context, viewer, photoID string, favorite bool) (*db.Photo, error)
	SetFavorites(ctx context.Context, viewer string, photoIDs []string, favorite bool) (int, error)
	ListAlbums(ctx context.Context, ownerID string) ([]db.AlbumView, error)
	GetAlbumView(ctx context.Context, ownerID, albumID string) (*db.AlbumDetail, error)
	CreateAlbum(ctx context.Context, ownerID, name string) (*db.AlbumView, error)
	CreateAlbumWithPhotos(ctx context.Context, ownerID, name string, photoIDs []string) (*db.AlbumView, error)
	AddPhotoToAlbum(ctx context.Context, ownerID, albumID, photoID string) (*db.AlbumView, error)
	AddPhotosToAlbum(ctx context.Context, ownerID, albumID string, photoIDs []string) (*db.AlbumView, error)
	RemovePhotoFromAlbum(ctx context.Context, ownerID, albumID, photoID string) (*db.AlbumView, error)
	ClearOwnerAlbumsAndFavorites(ctx context.Context, ownerID string) error
}
