import sqlite3
from typing import List, Optional, Tuple, Dict, Any
import json
from datetime import datetime

def get_db_connection():
    conn = sqlite3.connect('scripts.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with required tables."""
    conn = get_db_connection()
    try:
        # Check if scripts table exists
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='scripts'")
        if cursor.fetchone() is None:
            # Create scripts table with category
            conn.execute('''
            CREATE TABLE scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                body TEXT NOT NULL,
                accepts_reference BOOLEAN DEFAULT 0,
                category TEXT DEFAULT 'Uncategorized'
            )
            ''')
        else:
            # Check if category column exists
            cursor = conn.execute("PRAGMA table_info(scripts)")
            columns = [column[1] for column in cursor.fetchall()]
            if 'category' not in columns:
                # Add category column
                conn.execute('ALTER TABLE scripts ADD COLUMN category TEXT DEFAULT "Uncategorized"')
        
        # Check if script_args table exists
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='script_args'")
        if cursor.fetchone() is None:
            # Create script_args table
            conn.execute('''
            CREATE TABLE IF NOT EXISTS script_args (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                script_id INTEGER,
                args TEXT,
                working_dir TEXT,
                FOREIGN KEY (script_id) REFERENCES scripts (id)
            )
            ''')
        else:
            # Table exists – ensure required columns are present
            cursor = conn.execute("PRAGMA table_info(script_args)")
            arg_columns = [column[1] for column in cursor.fetchall()]
            if 'script_name' not in arg_columns:
                if 'name' in arg_columns:
                    # Attempt to rename column (SQLite >= 3.25)
                    try:
                        conn.execute('ALTER TABLE script_args RENAME COLUMN name TO script_name')
                    except sqlite3.OperationalError:
                        # Fallback: just add the new column (new rows will use it)
                        conn.execute('ALTER TABLE script_args ADD COLUMN script_name TEXT')
                else:
                    conn.execute('ALTER TABLE script_args ADD COLUMN script_name TEXT')
        
        # Check if working_dir column exists in script_args table
        cursor = conn.execute("PRAGMA table_info(script_args)")
        columns = [column[1] for column in cursor.fetchall()]
        if 'working_dir' not in columns:
            conn.execute('ALTER TABLE script_args ADD COLUMN working_dir TEXT')
        
        conn.commit()
    except Exception as e:
        print(f"Error initializing database: {e}")
        raise
    finally:
        conn.close()

def get_all_scripts() -> List[Dict[str, Any]]:
    """Get all scripts with their name and description."""
    conn = get_db_connection()
    try:
        cursor = conn.execute('SELECT id, name, description, accepts_reference, category FROM scripts ORDER BY category, name')
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_script_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Get a specific script by name (trims whitespace)."""
    name = name.strip()
    conn = get_db_connection()
    try:
        cursor = conn.execute('SELECT * FROM scripts WHERE name = ?', (name,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def save_script(name: str, description: str, body: str, accepts_reference:bool = False, category: str = 'Uncategorized') -> bool:
    """Save or update a script in the database."""
    name = name.strip()
    conn = get_db_connection()
    try:
        conn.execute('''
        INSERT INTO scripts (name, description, accepts_reference, body, category)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            description = excluded.description,
            accepts_reference = excluded.accepts_reference,
            body = excluded.body,
            category = excluded.category
        ''', (name, description, accepts_reference, body, category))
        conn.commit()
        return True
    except Exception as e:
        print(f"Error saving script: {e}")
        return False
    finally:
        conn.close()

def delete_script(name: str) -> bool:
    """Delete a script by name."""
    name = name.strip()
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute('DELETE FROM scripts WHERE name = ?', (name,))
        conn.commit()
        return True
    except sqlite3.Error:
        return False
    finally:
        conn.close()

def save_script_args(script_name: str, args: str, working_dir:str=None) -> bool:
    """Save script arguments and working directory, keeping only the last 10."""
    script_name = script_name.strip()
    conn = get_db_connection()
    c = conn.cursor()
    try:
        # Get script id
        c.execute('SELECT id FROM scripts WHERE name = ?', (script_name,))
        script = c.fetchone()
        if not script:
            return False
        
        col = get_arg_column(conn)

        # Prepare value for reference column
        ref_value = script['id'] if col == 'script_id' else script_name

        # Insert new args
        c.execute(f"INSERT OR IGNORE INTO script_args ({col}, args, working_dir) VALUES (?, ?, ?);", (ref_value, args, working_dir))
        current_timestamp = datetime.utcnow().isoformat()
        # Delete old args keeping only last 10
        c.execute(f'''
            INSERT INTO script_args ({col}, args, working_dir, used_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT({col}, args, working_dir) DO UPDATE SET
                used_at = excluded.used_at,
                working_dir = excluded.working_dir;
        ''', (ref_value, args, working_dir, current_timestamp))
        
        conn.commit()
        return True
    except sqlite3.Error as e:
        return False
    finally:
        conn.close()

def get_script_args(script_name: str) -> List[str]:
    """Get the last 10 arguments and working directory used for a script."""
    conn = get_db_connection()
    c = conn.cursor()
    try:
        col = get_arg_column(conn)
        if col == 'script_id':
            # look up id
            id_cursor = c.execute('SELECT id FROM scripts WHERE name = ?', (script_name,))
            id_row = id_cursor.fetchone()
            if not id_row:
                return []
            ref_value = id_row['id']
        else:
            ref_value = script_name

        c.execute(f'''
            SELECT args, working_dir FROM script_args 
            WHERE {col} = ?
            ORDER BY used_at DESC
            LIMIT 10
        ''', (ref_value,))
        args = [{'args': row['args'], 'working_dir': row['working_dir']} for row in c.fetchall()]
        return args
    except sqlite3.OperationalError as e:
        # Gracefully handle missing column (legacy DB)
        if 'no such column' in str(e).lower():
            return []
        raise
    finally:
        conn.close()

def get_categories() -> List[str]:
    """Get all unique categories."""
    conn = get_db_connection()
    try:
        cursor = conn.execute('SELECT DISTINCT category FROM scripts ORDER BY category')
        return [row['category'] for row in cursor.fetchall()]
    finally:
        conn.close()

# Initialize database when module is imported
init_db()

# New function to rename a script and optionally update its metadata
def rename_script(old_name: str, new_name: str, description: str, body: str, accepts_reference:bool = False, category: str = 'Uncategorized') -> bool:
    """Rename a script while preserving its ID and update its metadata.

    This updates the row in the scripts table and also rewrites any entries
    in the script_args table that reference the old name so history is preserved.
    Returns True on success, False otherwise (e.g., new_name already exists)."""
    old_name = old_name.strip()
    new_name = new_name.strip()
    conn = get_db_connection()
    try:
        # Ensure the new name is unique (excluding the current row)
        cursor = conn.execute('SELECT id FROM scripts WHERE name = ?', (new_name,))
        row = cursor.fetchone()
        if row and row['id']:
            # If another row (different id) has that name, abort
            cursor2 = conn.execute('SELECT id FROM scripts WHERE name = ?', (old_name,))
            old_row = cursor2.fetchone()
            if not old_row or old_row['id'] != row['id']:
                return False

        # Temporarily disable FK constraints so we can update the PK column
        conn.execute('PRAGMA foreign_keys = OFF')

        # Update the scripts row in-place (keeps the same id)
        conn.execute(
            'UPDATE scripts SET name = ?, description = ?, body = ?, accepts_reference=?,  category = ? WHERE name = ?',
            (new_name, description, body, accepts_reference, category, old_name)
        )

        # Update argument history to point to the new name
        col = get_arg_column(conn)
        if col in ('script_name', 'name'):
            conn.execute(
                f'UPDATE script_args SET {col} = ? WHERE {col} = ?',
                (new_name, old_name)
            )
        # if 'script_id', no update necessary

        # Re-enable FK constraints
        conn.execute('PRAGMA foreign_keys = ON')

        conn.commit()
        return True
    except Exception as e:
        print(f"Error renaming script from {old_name} to {new_name}: {e}")
        return False
    finally:
        conn.close()

# Utility ------------------------------------------------------------
def get_arg_column(conn: sqlite3.Connection) -> str:
    """Return the column name in *script_args* that stores the script name.

    Modern schema uses *script_name*, legacy uses *name*. We inspect PRAGMA
    table_info(script_args) and return whichever exists. Defaults to
    'script_name' if table doesn't exist (callers will create it)."""
    try:
        cur = conn.execute("PRAGMA table_info(script_args)")
        cols = [row[1] for row in cur.fetchall()]
        if 'script_id' in cols:
            return 'script_id'
        if 'script_name' in cols:
            return 'script_name'
        if 'name' in cols:
            return 'name'
    except sqlite3.OperationalError:
        pass
    # Default preference order: script_id, script_name
    return 'script_id' 