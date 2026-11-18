package storage

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/hirochachacha/go-smb2"
)

// SMBConfig addresses one directory inside an SMB2/3 share.
type SMBConfig struct {
	Addr     string // host:port
	Share    string
	Dir      string // slash-separated directory inside the share; "" = share root
	User     string // "user" or "DOMAIN\user"
	Password string
}

// SMB is a read-only Storage over a native SMB2/3 session. The session is
// dialed lazily and redialed once when a call fails on a dropped connection.
type SMB struct {
	cfg SMBConfig

	mu      sync.Mutex
	conn    net.Conn
	session *smb2.Session
	share   *smb2.Share
}

func NewSMB(cfg SMBConfig) *SMB {
	cfg.Dir = strings.Trim(strings.ReplaceAll(cfg.Dir, `\`, "/"), "/")
	return &SMB{cfg: cfg}
}

func (s *SMB) Backend() string { return "smb" }

func (s *SMB) Put(context.Context, string, io.Reader) error { return ErrReadOnly }
func (s *SMB) Delete(context.Context, string) error         { return ErrReadOnly }

func (s *SMB) URL(context.Context, string, time.Duration) (string, error) {
	return "", ErrReadOnly
}

func (s *SMB) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	p, err := s.path(key)
	if err != nil {
		return nil, err
	}
	var f *smb2.File
	err = s.do(ctx, func(sh *smb2.Share) error {
		var oerr error
		f, oerr = sh.Open(p)
		return oerr
	})
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *SMB) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	p, err := s.path(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	var st os.FileInfo
	err = s.do(ctx, func(sh *smb2.Share) error {
		var serr error
		st, serr = sh.Stat(p)
		return serr
	})
	if err != nil {
		return ObjectInfo{}, err
	}
	return smbInfo(key, st), nil
}

func (s *SMB) Walk(ctx context.Context, prefix string, fn func(ObjectInfo) error) error {
	rel := ""
	if strings.Trim(prefix, "/") != "" {
		p, err := remotePath(prefix)
		if err != nil {
			return err
		}
		rel = strings.TrimPrefix(p, "/")
	}
	return s.walk(ctx, rel, fn)
}

func (s *SMB) walk(ctx context.Context, rel string, fn func(ObjectInfo) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var entries []os.FileInfo
	err := s.do(ctx, func(sh *smb2.Share) error {
		var rerr error
		entries, rerr = sh.ReadDir(s.join(rel))
		return rerr
	})
	if err != nil {
		return err
	}
	for _, e := range entries {
		child := e.Name()
		if rel != "" {
			child = rel + "/" + e.Name()
		}
		if e.IsDir() {
			if err := s.walk(ctx, child, fn); err != nil {
				return err
			}
			continue
		}
		if err := fn(smbInfo(child, e)); err != nil {
			return err
		}
	}
	return nil
}

// Close drops the SMB session.
func (s *SMB) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dropLocked()
	return nil
}

func (s *SMB) path(key string) (string, error) {
	p, err := remotePath(key)
	if err != nil {
		return "", err
	}
	return s.join(strings.TrimPrefix(p, "/")), nil
}

func (s *SMB) join(rel string) string {
	switch {
	case s.cfg.Dir == "":
		return rel
	case rel == "":
		return s.cfg.Dir
	default:
		return path.Join(s.cfg.Dir, rel)
	}
}

func (s *SMB) do(ctx context.Context, op func(*smb2.Share) error) error {
	for attempt := 0; ; attempt++ {
		sh, err := s.mount(ctx)
		if err != nil {
			return err
		}
		err = op(sh.WithContext(ctx))
		if err == nil || errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) || ctx.Err() != nil || attempt > 0 {
			return err
		}
		// Anything else may be a stale session (NAS reboot, idle drop): redial once.
		s.mu.Lock()
		if s.share == sh {
			s.dropLocked()
		}
		s.mu.Unlock()
	}
}

func (s *SMB) mount(ctx context.Context) (*smb2.Share, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share != nil {
		return s.share, nil
	}
	d := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return nil, err
	}
	user, domain := s.cfg.User, ""
	if i := strings.IndexAny(user, `\/`); i >= 0 {
		domain, user = user[:i], user[i+1:]
	}
	dialer := &smb2.Dialer{Initiator: &smb2.NTLMInitiator{User: user, Password: s.cfg.Password, Domain: domain}}
	session, err := dialer.DialContext(ctx, conn)
	if err != nil {
		conn.Close()
		return nil, err
	}
	share, err := session.Mount(s.cfg.Share)
	if err != nil {
		_ = session.Logoff()
		conn.Close()
		return nil, err
	}
	s.conn, s.session, s.share = conn, session, share
	return share, nil
}

func (s *SMB) dropLocked() {
	if s.share != nil {
		_ = s.share.Umount()
	}
	if s.session != nil {
		_ = s.session.Logoff()
	}
	if s.conn != nil {
		_ = s.conn.Close()
	}
	s.conn, s.session, s.share = nil, nil, nil
}

func smbInfo(key string, st os.FileInfo) ObjectInfo {
	info := ObjectInfo{Key: key, Size: st.Size(), ModTime: st.ModTime()}
	if fst, ok := st.(*smb2.FileStat); ok {
		info.CreatedAt = fst.CreationTime
	}
	return info
}
