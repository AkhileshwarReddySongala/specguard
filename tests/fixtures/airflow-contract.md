# Airflow contribution contract (reduced)

- Comments should explain why a non-obvious choice exists,
  not narrate the code.
- Document how selective checks behave for affected components.
- Add a newsfragment for user-visible changes.
- Maintain the existing coverage expectation for modified modules.
- Use `pytest.mark.db_test` for database-backed tests.
- Every API route must include a matching test.
