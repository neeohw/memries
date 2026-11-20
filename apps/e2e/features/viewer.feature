Feature: Photo viewer
  Opens from Memories. Favorite, album, next/previous, close.

  Scenario Outline: Viewer actions from <origin>
    Given I am signed in
    When I create an album named "Viewer"
    And I open the "<origin>" tab
    And I open the photo from "Monday, 31 August 2026"
    Then the photo viewer is open
    When I add the viewer photo to favorites
    And I add the viewer photo to album "Viewer"
    And I go to the next photo
    And I go to the previous photo
    And I close the photo viewer
    Then the photo viewer is closed
    And the album "Viewer" should have 1 photos

    Examples:
      | origin   |
      | Memories |
