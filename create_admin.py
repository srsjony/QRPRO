import sqlite3

conn = sqlite3.connect('database.db')
c = conn.cursor()

c.execute("INSERT INTO users (username,password,is_admin) VALUES (?,?,1)",
          ("admin","admin123"))

conn.commit()
conn.close()

print("Admin created successfully")